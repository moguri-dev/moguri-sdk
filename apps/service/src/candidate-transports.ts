import { randomUUID } from "node:crypto";
import { MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { projectCandidateTransport, type CandidateTransportRecord, type CandidateNativeRootGrant } from "../../../packages/protocol/src/candidate-workspaces.ts";
import type { EventInput, RemoteExecution, SandboxExecution, Session, StoredEvent } from "../../../packages/protocol/src/index.ts";
import { CandidateWorkerOperationSchema, CandidateWorkerResultSchema, type CandidateWorkerAction, type CandidateWorkerOperation, type CandidateWorkerResult, type CandidateWorkerScope } from "./candidate-worker-protocol.ts";
import { frameDigest } from "./worker-wire.ts";
import { WorkerRequestSchema, type WorkerRequest } from "./worker-protocol.ts";
import type { WorkerConnection, WorkerFrame } from "./worker-connection.ts";
import { digest, type EventStore } from "./store.ts";
import { candidateRecoveryEvidence, type CandidateJournalInspection } from "./candidate-reconciliation.ts";
import { candidateRecoveryLaunch, type CandidateStandaloneLaunch } from "./candidate-recovery-launch.ts";
import { candidateDocument } from "./candidate-files.ts";
import { sameCandidateRoot } from "../../../packages/protocol/src/candidates.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { SourceRoot } from "./repository-source.ts";
import { validateCandidateRecoveryResult } from "./candidate-reconciliation.ts";

export type CandidateLaunch =
  | { kind: "Remote"; execution: RemoteExecution }
  | { kind: "Sandbox"; execution: SandboxExecution }
  | { kind: "attached"; execution: RemoteExecution | SandboxExecution; parentRequestId: string };
export interface CandidateBinding {
  scope: CandidateWorkerScope;
  launch(id: string): CandidateLaunch;
  current(): void;
  nativeRoot?(operation: CandidateWorkerOperation, guest: SourceRoot): Promise<CandidateNativeRootGrant>;
}
export interface CandidateTransportHost {
  events(): StoredEvent[];
  commit(events: EventInput[]): void;
  binding(session: Session): Promise<CandidateBinding>;
  open(launch: CandidateLaunch, observed: (value: Record<string, unknown>) => void): { connection: WorkerConnection; clean(): Promise<boolean> };
  inspect?(record: CandidateTransportRecord, launch: CandidateStandaloneLaunch, after: number, signal: AbortSignal): Promise<CandidateJournalInspection>;
}
type CandidateRequest = Extract<WorkerRequest, { kind: "candidate.root" | "candidate.boundary" | "candidate.complete" | "candidate.finished" | "candidate.released" }>;
interface Active {
  operation: CandidateWorkerOperation; record: CandidateTransportRecord; binding: CandidateBinding; launch: CandidateLaunch;
  child?: WorkerConnection; signal: AbortSignal; result?: CandidateWorkerResult; terminal?: "completed" | "failed" | "partial";
  terminalDiagnostic?: string | null;
  boundary(phase: "attempt" | "observed", path: string | null): Promise<void>;
  resolve(result: CandidateWorkerResult): void; reject(error: Error): void;
  chain: Promise<void>; finalize(): Promise<void>;
  settled: Promise<void>; settledResolve(): void;
  recovered?: boolean;
}
export function candidateTransportHistory(events: StoredEvent[]): CandidateTransportRecord[] {
  const records = new Map<string, CandidateTransportRecord>();
  for (const event of events) projectTransportEvent(records, event);
  return [...records.values()];
}
function projectTransportEvent(records: Map<string, CandidateTransportRecord>, event: StoredEvent): void {
  if (event.event_type === "candidate.transport_recorded") {
    const record = event.payload.transport;
    if (record.profileId !== event.profile_id || record.projectId !== event.project_id ||
      (event.artifact_id ?? null) !== (record.ownerKind === "candidate" ? record.ownerId : null) ||
      record.ownerKind === "read" && event.session_id !== record.sessionId || record.ownerKind !== "read" && event.session_id != null) {
      throw new MoguriError("candidate_transport_corrupt", "Original transport history changed its exact profile/project or caller-owned retention compartment.", 409);
    }
    records.set(record.id, projectCandidateTransport(records.get(record.id), record));
  }
}
export class CandidateTransports {
  private readonly active = new Map<string, Active>();
  private history: StoredEvent[] = [];
  private readonly projected = new Map<string, CandidateTransportRecord>();
  constructor(private readonly store: EventStore, private readonly host: CandidateTransportHost) {}
  records(): CandidateTransportRecord[] {
    const events = this.host.events(), length = this.history.length;
    const appended = length <= events.length && (!length || events[length - 1]?.id === this.history[length - 1]?.id && events[0]?.id === this.history[0]?.id);
    if (!appended) this.projected.clear();
    for (const event of events.slice(appended ? length : 0)) projectTransportEvent(this.projected, event);
    this.history = events.slice(); return [...this.projected.values()];
  }
  record(id: string): CandidateTransportRecord {
    const record = this.records().find((record) => record.id === id && record.profileId === this.store.profileId);
    if (!record) throw new MoguriError("candidate_transport_missing", "Original candidate transport is unavailable or outside this exact retained profile.", 404);
    return record;
  }
  async reconcile(id: string, expectedRevision: number, finish: WorkspaceFinish) {
    const record = this.record(id), intent = finish.intent;
    if (!intent) throw new MoguriError("candidate_reconcile_intent", "Read-only reconciliation requires its canonical actual-user command identity.", 409);
    if (record.recovery?.commandId === intent.id) {
      if (record.recovery.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "The original reconciliation command changed. No inspection or effect was replayed.", 409);
      return finish([], { id, revision: record.revision });
    }
    if (record.revision !== expectedRevision) throw new MoguriError("candidate_reconcile_stale", "Original transport revision changed. Read its exact retained state again.", 409);
    if (record.cleanupConfirmed) return finish([], { id, revision: record.revision });
    if (record.status !== "partial") throw new MoguriError("candidate_reconcile_active", "Stop/wait for the exact original operation before reconciliation. This read-only action never stops a worker or grants another effect.", 409);
    if (!this.host.inspect) throw new MoguriError("candidate_reconcile_unavailable", "This original transport has no qualified read-only journal inspector. Ownership remains quarantined; no fallback.", 409);
    const launch = candidateRecoveryLaunch(record), signal = AbortSignal.timeout(30_000);
    let page = await this.host.inspect(record, launch, record.sequence, signal);
    if (page.status.acknowledged < record.sequence) {
      const originalProof = page.proof;
      page = await this.host.inspect(record, launch, page.status.acknowledged, signal);
      if (page.proof !== originalProof) throw new MoguriError("candidate_reconcile_changed", "Original journal changed during bounded inspection. Retry an explicit read later; no receipt or cleanup was adopted.", 409);
    }
    const retained = record.resultDigest ? parse(CandidateWorkerResultSchema, JSON.parse(this.store.blob(record.resultDigest))) : null;
    const known = this.host.events().flatMap((event) => event.event_type === "candidate.transport_recorded" && event.payload.transport.id === id && event.payload.frame ?
      [{ sequence: event.payload.frame.sequence, digest: event.payload.frame.digest }] : []);
    const evidence = candidateRecoveryEvidence(record, page, retained, known);
    const late = page.frames.find((frame) => frame.request.kind === "candidate.complete");
    const result = late?.request.kind === "candidate.complete" ? parse(CandidateWorkerResultSchema, late.request.result) : retained;
    if (!result) throw new MoguriError("candidate_reconcile_unconfirmed", "Original complete result fence is missing. Ownership remains quarantined.", 409);
    this.recoveryOwner(record, result, page.frames);
    const fresh = this.record(id); signal.throwIfAborted();
    if (fresh.revision !== record.revision) throw new MoguriError("candidate_reconcile_stale", "Original transport changed while inspecting its exact journal. No stale receipt was adopted.", 409);
    const resultDigest = this.store.putBlob(JSON.stringify(result));
    if (resultDigest !== evidence.resultDigest) throw new MoguriError("candidate_reconcile_result", "Original result digest changed during retention. No source or cleanup was adopted.", 409);
    const next = projectCandidateTransport(fresh, { ...fresh, revision: fresh.revision + 1, sequence: evidence.journal.sequence, resultDigest,
      cleanupConfirmed: true, status: "partial", recovery: { version: 1, actor: "user", commandId: intent.id, commandDigest: intent.digest,
        inspectedAt: new Date().toISOString(), evidence }, diagnostic: "Exact original terminal/cleanup receipts were recovered read-only. This operation remains partial; original ACK telemetry, file/job outcomes and accounting were not upgraded or replayed." });
    const response = finish([this.event(next)], { id, revision: next.revision });
    const active = this.active.get(id);
    if (active) { active.record = next; active.recovered = true; active.settledResolve(); this.active.delete(id); }
    return response;
  }
  private recoveryOwner(record: CandidateTransportRecord, result: CandidateWorkerResult, frames: CandidateJournalInspection["frames"]): void {
    const invalid = (): never => { throw new MoguriError("candidate_reconcile_binding", "Recovered result lost its exact original candidate/workspace intent, roots or proposed bytes. No file/job outcome or acceptance was repaired.", 409); };
    if (record.ownerKind === "candidate") {
      const event = this.host.events().findLast((event) => event.event_type === "candidate.saved" && event.payload.candidate.id === record.ownerId);
      if (event?.event_type !== "candidate.saved" || result.type !== "written") return invalid();
      const candidate = event.payload.candidate, owned = candidate.stageIntent.jobId === record.id ? candidate.stageIntent : candidate.applyIntent?.jobId === record.id ? candidate.applyIntent : null;
      const document = candidateDocument(this.store.blob(candidate.documentDigest), candidate);
      const last = { attempt: -1, observed: -1 };
      for (const { request } of frames) if (request.kind === "candidate.boundary" && request.phase !== "operation") {
        const index = request.path ? candidate.paths.indexOf(request.path) : -1;
        if (index < 0 || index <= last[request.phase]) return invalid();
        last[request.phase] = index;
      }
      if (!owned || owned.sessionId !== record.sessionId || candidate.profileId !== record.profileId || candidate.projectId !== record.projectId ||
        record.authorityDigest !== (candidate.stageIntent.jobId === record.id ? document.authorityDigest : candidate.acceptance?.authorityDigest) ||
        result.result.phase !== (candidate.stageIntent.jobId === record.id ? "stage" : "apply") ||
        !sameCandidateRoot(result.result.source, candidate.source) || !sameCandidateRoot(result.result.stage, candidate.stage) ||
        result.result.files.length !== candidate.paths.length || result.result.files.some((file, index) => {
          const edit = document.patch.edits[index];
          return !edit || file.path !== edit.path || file.digest !== digest(edit.text) || file.bytes !== Buffer.byteLength(edit.text);
        })) return invalid();
    } else if (record.ownerKind === "workspace") {
      const event = this.host.events().findLast((event) => event.event_type === "candidate.workspace_recorded" && event.payload.workspace.id === record.ownerId);
      if (event?.event_type !== "candidate.workspace_recorded" || result.type !== "created") return invalid();
      const workspace = event.payload.workspace;
      if (workspace.operationId !== record.id || workspace.originSessionId !== record.sessionId || workspace.authorityDigest !== record.authorityDigest ||
        workspace.profileId !== record.profileId || workspace.projectId !== record.projectId || !sameCandidateRoot(workspace.source, result.source) ||
        result.stage.workspaceId !== workspace.id || result.stage.root !== workspace.plannedRoot) return invalid();
    }
  }
  private event(transport: CandidateTransportRecord, frame?: WorkerFrame): EventInput {
    return { event_type: "candidate.transport_recorded", profile_id: transport.profileId, project_id: transport.projectId,
      ...(transport.ownerKind === "read" ? { session_id: transport.sessionId } : {}),
      payload: { transport, ...(frame ? { frame: { ...frame, env: frame.env ?? "Remote" } } : {}) } };
  }
  private update(active: Active, changes: Partial<CandidateTransportRecord>, frame?: WorkerFrame): void {
    const next = projectCandidateTransport(active.record, { ...active.record, ...changes, revision: active.record.revision + 1 });
    this.host.commit([this.event(next, frame)]); active.record = next;
  }
  private async nativeRootsCurrent(active: Active): Promise<void> {
    for (const grant of active.record.nativeRoots ?? []) {
      if (!active.binding.nativeRoot) throw new MoguriError("candidate_native_identity", "The original private-root inspector is unavailable; no further effect was granted.", 409);
      const actual = await active.binding.nativeRoot(active.operation, { root: grant.root, ...grant.guest });
      if (JSON.stringify(actual) !== JSON.stringify(grant)) throw new MoguriError("candidate_native_identity", "The exact granted host-private inode changed; no further effect or successful result was accepted.", 409);
    }
  }
  activeSessionIds(): string[] { return [...new Set([...this.active.values()].map((active) => active.record.sessionId))]; }
  binding(session: Session): Promise<CandidateBinding> { return this.host.binding(session); }
  async execute(binding: CandidateBinding, owner: { kind: CandidateTransportRecord["ownerKind"]; id: string; authorityDigest: string; operationId?: string },
    action: CandidateWorkerAction, signal: AbortSignal,
    boundary: Active["boundary"] = async () => {}): Promise<CandidateWorkerResult> {
    binding.current(); signal.throwIfAborted();
    const id = owner.operationId ?? randomUUID();
    if (this.records().some((record) => record.id === id)) throw new MoguriError("candidate_no_replay", "This exact operation already has retained intent. Inspect its original outcome; no worker/effect was replayed.", 409);
    const operation = parse(CandidateWorkerOperationSchema, { ...action, kind: "candidate.operation", operationId: id, scope: structuredClone(binding.scope) });
    const launch = binding.launch(id), attached = launch.kind === "attached", initialSequence = attached ? launch.execution.lastSequence : 0;
    const record: CandidateTransportRecord = { version: operation.scope.env === "Sandbox" ? 2 : 1,
      ...(operation.scope.env === "Sandbox" ? { nativeRoots: [] } : {}), id, ownerId: owner.id, ownerKind: owner.kind, profileId: operation.scope.profileId,
      sessionId: operation.scope.sessionId, projectId: operation.scope.projectId, operationDigest: frameDigest(operation),
      authorityDigest: owner.authorityDigest, boundary: operation.scope.boundary, launchJson: JSON.stringify(launch),
      observationJson: null, revision: 0, sequence: initialSequence, status: "running", resultDigest: null, stopRequested: false, terminalAcknowledged: false, cleanupConfirmed: false, diagnostic: null };
    projectCandidateTransport(undefined, record);
    this.host.commit([this.event(record)]);
    let active!: Active, timeout: ReturnType<typeof setTimeout> | undefined, abortTimeout: ReturnType<typeof setTimeout> | undefined;
    let detachParent: (() => void) | undefined;
    const result = new Promise<CandidateWorkerResult>((resolve, reject) => {
      const settled = Promise.withResolvers<void>();
      active = { operation, record, binding, launch, signal, boundary, resolve, reject, chain: Promise.resolve(), finalize: async () => {},
        settled: settled.promise, settledResolve: settled.resolve };
      this.active.set(id, active);
    });
    const fail = (error: unknown) => {
      if (active.record.status !== "running") return;
      const diagnostic = error instanceof MoguriError ? error.message : "The original candidate transport lost its exact result/terminal receipt. Possible effects and cleanup remain unconfirmed; no replay or fallback.";
      try { this.update(active, { status: "partial", diagnostic }); }
      catch { console.error("Candidate transport outcome persistence failed; original intent remains unsettled and is never replayed."); }
      finally { active.reject(error instanceof MoguriError ? error : new MoguriError("candidate_transport_partial", diagnostic, 409)); }
    };
    const stop = () => {
      try { if (active.record.status === "running" && !active.record.stopRequested) this.update(active, { stopRequested: true }); }
      catch { console.error("Candidate stop intent persistence failed; actual cancellation is still requested without claiming a retained acknowledgement."); }
      finally {
        active.child?.send(attached ? { kind: "candidate.stop", operationId: id } : { kind: "stop" });
        abortTimeout ??= setTimeout(() => { fail(new MoguriError("candidate_stop_unconfirmed", "Original worker did not acknowledge candidate cancellation. Both exact roots remain quarantined.", 409)); if (!attached) active.child?.kill("SIGTERM"); }, 6500);
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      binding.current(); signal.throwIfAborted();
      if (attached && operation.scope.env === "Sandbox") {
        const execution = launch.execution;
        if (!("nativeSessionId" in execution) || !execution.nativeSessionId || !execution.planDigest || !execution.signerFingerprint) {
          throw new MoguriError("candidate_native_identity", "The exact waiting parent has no original signed guest identity. No native root grant or operation was admitted.", 409);
        }
        this.update(active, { observationJson: JSON.stringify({ nativeSessionId: execution.nativeSessionId, planDigest: execution.planDigest,
          signerFingerprint: execution.signerFingerprint, workerPid: execution.workerPid }) });
      }
      const opened = this.host.open(launch, (value) => {
        if (!active.recovered && active.record.status !== "completed") this.update(active, { observationJson: JSON.stringify({ ...(active.record.observationJson ? JSON.parse(active.record.observationJson) : {}), ...value }) });
      }); active.child = opened.connection;
      active.finalize = async () => {
        if (active.record.status === "completed") return;
        const clean = attached || await opened.clean();
        if (active.record.status === "partial") {
          if (clean && active.record.terminalAcknowledged) this.update(active, { cleanupConfirmed: true });
          if (clean && active.record.terminalAcknowledged) { active.settledResolve(); this.active.delete(id); }
          return;
        }
        if (!clean || !active.record.terminalAcknowledged || active.terminal !== "completed" || !active.result ||
          signal.aborted || active.record.stopRequested) {
          const diagnostic = active.terminalDiagnostic ?? "Original result, cancellation or owned-worker cleanup is incomplete. Retained bytes are not replayed or treated as complete.";
          this.update(active, { status: "partial", cleanupConfirmed: clean && active.record.terminalAcknowledged, diagnostic });
          active.reject(new MoguriError("candidate_transport_partial", diagnostic, 409));
          if (clean && active.record.terminalAcknowledged) { active.settledResolve(); this.active.delete(id); }
          return;
        }
        try { binding.current(); }
        catch (error) {
          const diagnostic = error instanceof MoguriError ? error.message : "Original candidate authority changed after its actual call stack settled. No successful effect was adopted.";
          this.update(active, { status: "partial", cleanupConfirmed: true, diagnostic });
          active.reject(new MoguriError("candidate_transport_partial", diagnostic, 409)); active.settledResolve(); this.active.delete(id); return;
        }
        this.update(active, { status: "completed", cleanupConfirmed: true, diagnostic: null });
        active.resolve(active.result); active.settledResolve(); this.active.delete(id);
      };
      if (!attached) {
        opened.connection.events.on("message", (value, frame) => {
          active.chain = active.chain.then(async () => { await this.frame(value, frame); }).catch(fail);
        });
        opened.connection.events.once("error", fail);
        opened.connection.events.once("exit", () => { void active.chain.then(() => active.finalize()).catch(fail); });
      } else {
        const ended = () => fail(new MoguriError("candidate_transport_partial", "The original public compound parent ended before this exact candidate operation released its call stack. Original effects and cleanup remain unconfirmed; no replay or replacement parent.", 409));
        opened.connection.events.once("exit", ended);
        opened.connection.events.once("error", ended);
        detachParent = () => { opened.connection.events.off("exit", ended); opened.connection.events.off("error", ended); };
      }
      timeout = setTimeout(() => { stop(); fail(new MoguriError("candidate_transport_timeout", "The bounded original candidate operation timed out. Its effects/cleanup remain unconfirmed and will not be replayed.", 409)); }, 150_000);
      opened.connection.send(attached ? { kind: "candidate.start", parentRequestId: launch.parentRequestId, operation } :
        { kind: "start", root: operation.scope.boundary.sourceRoot, env: operation.scope.env, readOnly: false, context: [], operation },
      (error) => { if (error) fail(error); });
      if (signal.aborted) stop();
      return await result;
    } catch (error) {
      if (!active.child && active.record.status === "running") {
        const diagnostic = error instanceof MoguriError ? error.message : "The original candidate launch was refused before a worker existed. No operation was replayed.";
        try { this.update(active, { status: "partial", cleanupConfirmed: true, diagnostic }); }
        finally { active.reject(error instanceof Error ? error : new MoguriError("candidate_transport_partial", diagnostic, 409)); active.settledResolve(); this.active.delete(id); }
      } else fail(error);
      return await result;
    }
    finally {
      detachParent?.();
      clearTimeout(timeout); clearTimeout(abortTimeout); signal.removeEventListener("abort", stop);
      if (active.record.status !== "completed") active.child?.send(attached ? { kind: "candidate.stop", operationId: id } : { kind: "stop" });
      if (active.record.status !== "completed") {
        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([active.settled, new Promise<void>((resolve) => { settleTimer = setTimeout(resolve, 6500); })]); }
        finally { clearTimeout(settleTimer); }
      }
    }
  }
  async frame(value: unknown, frame?: WorkerFrame): Promise<boolean> {
    const request = parse(WorkerRequestSchema, value);
    const operationId = request.kind === "candidate.root" || request.kind === "candidate.boundary" || request.kind === "candidate.complete" ||
      request.kind === "candidate.finished" || request.kind === "candidate.released" ? request.operationId : null;
    const active = operationId ? this.active.get(operationId) : frame ? [...this.active.values()].find((value) => value.launch.kind !== "attached" && value.record.id === frame.executionId) : undefined;
    if (!active) return false;
    if (active.record.status === "completed") return true;
    const expectedExecutionId = active.launch.execution.id;
    if (!frame || frame.executionId !== expectedExecutionId || frame.digest !== frameDigest(request) ||
      frame.sequence <= active.record.sequence || active.launch.kind !== "attached" && frame.sequence !== active.record.sequence + 1) {
      throw new MoguriError("candidate_frame", "Candidate receipt changed its original execution, authenticated frame or exact cursor. No replay.", 409);
    }
    const reply = (requestId: string) => active.child!.send({ kind: "reply", requestId, value: { accepted: true } });
    if (operationId) {
      const candidate = request as CandidateRequest;
      if (candidate.operationDigest !== active.record.operationDigest) throw new MoguriError("candidate_frame", "Candidate result changed its exact operation identity.", 409);
      if (candidate.kind === "candidate.root") {
        active.binding.current(); active.signal.throwIfAborted();
        if (active.record.status !== "running" || active.record.version !== 2 || !active.record.nativeRoots || !active.binding.nativeRoot ||
          active.record.nativeRoots.some((grant) => grant.root === candidate.guest.root) || !active.record.observationJson) {
          throw new MoguriError("candidate_native_identity", "This exact live native operation has no new private-root grant boundary. No historical or repeated identity was adopted.", 409);
        }
        const observed = JSON.parse(active.record.observationJson);
        if (!observed.nativeSessionId || !observed.planDigest || !observed.signerFingerprint) {
          throw new MoguriError("candidate_native_identity", "The original signed guest has not authenticated its identity. No private-root grant was issued.", 409);
        }
        const nativeRoot = await active.binding.nativeRoot(active.operation, candidate.guest);
        active.binding.current(); active.signal.throwIfAborted();
        this.update(active, { sequence: frame.sequence, nativeRoots: [...active.record.nativeRoots, nativeRoot] }, frame);
        active.child!.send({ kind: "reply", requestId: candidate.requestId, value: { accepted: true, nativeRoot } });
      } else if (candidate.kind === "candidate.boundary") {
        if (active.record.status === "partial" && candidate.phase !== "observed") {
          this.update(active, { sequence: frame.sequence }, frame);
          active.child!.send({ kind: "reply", requestId: candidate.requestId, halt: true, error: "This original candidate operation is partial. No further effect, approval or replay." });
          active.child?.acknowledge?.(frame.sequence); return true;
        }
        if (candidate.phase !== "observed") {
          try { active.binding.current(); active.signal.throwIfAborted(); await this.nativeRootsCurrent(active); }
          catch (error) {
            const diagnostic = error instanceof MoguriError ? error.message : "The original candidate authority was refused before its next boundary. No further effect or fallback was authorized.";
            this.update(active, { sequence: frame.sequence, status: "partial", diagnostic }, frame);
            active.child!.send({ kind: "reply", requestId: candidate.requestId, halt: true, error: diagnostic });
            active.child?.acknowledge?.(frame.sequence);
            active.reject(new MoguriError("candidate_transport_partial", diagnostic, 409)); return true;
          }
        }
        if (candidate.phase !== "operation") await active.boundary(candidate.phase, candidate.path);
        this.update(active, { sequence: frame.sequence }, frame); reply(candidate.requestId);
      } else if (candidate.kind === "candidate.complete") {
        await this.nativeRootsCurrent(active);
        const result = parse(CandidateWorkerResultSchema, candidate.result);
        validateCandidateRecoveryResult(active.record, result);
        if (Buffer.byteLength(JSON.stringify(result)) > 160 * 1024) throw new MoguriError("candidate_result_limit", "Complete candidate transport result exceeds its bounded envelope. Nothing was truncated.", 409);
        const resultDigest = this.store.putBlob(JSON.stringify(result));
        this.update(active, { sequence: frame.sequence, resultDigest }, frame); active.result = result; reply(candidate.requestId);
      } else if (candidate.kind === "candidate.finished") {
        active.terminal = candidate.outcome; active.terminalDiagnostic = candidate.diagnostic;
        this.update(active, { sequence: frame.sequence, terminalAcknowledged: true }, frame); reply(candidate.requestId);
      } else {
        this.update(active, { sequence: frame.sequence }, frame);
        if (active.launch.kind !== "attached" || candidate.outcome !== active.terminal) throw new MoguriError("candidate_terminal", "Original candidate release has no acknowledged matching terminal call stack.", 409);
        await active.finalize();
      }
    } else if (request.kind === "ack") this.update(active, { sequence: frame.sequence }, frame);
    else if (request.kind === "finished" && active.launch.kind !== "attached") {
      active.terminal = request.outcome === "completed" ? "completed" : request.outcome === "failed" ? "failed" : "partial";
      active.terminalDiagnostic = request.diagnostic;
      this.update(active, { sequence: frame.sequence, terminalAcknowledged: true }, frame); reply(request.requestId);
    } else throw new MoguriError("candidate_protocol", "Model-free candidate work requested an unrelated model/tool/control capability. No authority was granted.", 409);
    active.child?.acknowledge?.(frame.sequence); return true;
  }
  stopOwner(id: string): void {
    for (const active of this.active.values()) if (active.record.ownerId === id) {
      try { if (!active.record.stopRequested) this.update(active, { stopRequested: true }); }
      catch { console.error("Candidate stop intent could not be retained; actual cancellation was still requested without a retained acknowledgement."); }
      finally { active.child?.send(active.launch.kind === "attached" ? { kind: "candidate.stop", operationId: active.record.id } : { kind: "stop" }); }
    }
  }
  stopSession(id: string): void {
    for (const active of this.active.values()) if (active.record.sessionId === id) this.stopOwner(active.record.ownerId);
  }
  async settleSession(id: string): Promise<void> {
    this.stopSession(id);
    const active = [...this.active.values()].filter((value) => value.record.sessionId === id);
    if (!active.length) {
      if (this.records().some((record) => record.sessionId === id && !record.cleanupConfirmed)) throw new MoguriError("candidate_cleanup_pending", "Original durable candidate worker cleanup is unconfirmed after control loss/restart. Preserve its exact key, grants and resources; no process ownership or safe replay was inferred.", 409);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all(active.map((value) => value.settled)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MoguriError("candidate_cleanup_pending", "Original candidate workers have not acknowledged terminal cleanup. Retain all independent resources and proposal grants; no deletion or replay.", 409)), 6500);
      })]);
    } finally { clearTimeout(timer); }
    if (this.records().some((record) => record.sessionId === id && !record.cleanupConfirmed)) throw new MoguriError("candidate_cleanup_pending", "Original candidate transport has no exact confirmed cleanup receipt. Session deletion cannot erase its ownership.", 409);
  }
  async settleOwners(ids: string[]): Promise<void> {
    for (const id of ids) this.stopOwner(id);
    const active = [...this.active.values()].filter((value) => value.record.ownerKind === "candidate" && ids.includes(value.record.ownerId));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all(active.map((value) => value.settled)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MoguriError("candidate_cleanup_pending", "Original candidate operations remain unsettled. Independent workspace creation was not cancelled or deleted.", 409)), 6500);
      })]);
    } finally { clearTimeout(timer); }
    if (this.records().some((record) => record.ownerKind === "candidate" && ids.includes(record.ownerId) && !record.cleanupConfirmed)) throw new MoguriError("candidate_cleanup_pending", "Retained candidate transport cleanup remains unconfirmed. Keep original results and keys; no deletion/replay.", 409);
  }
  failed(id: string, error: unknown): void {
    const active = this.active.get(id);
    if (!active) return;
    const diagnostic = error instanceof MoguriError ? error.message : "The original candidate frame could not be retained. No result or effect was replayed; both roots remain unconfirmed.";
    try { if (active.record.status === "running") this.update(active, { status: "partial", diagnostic }); }
    catch { console.error("Candidate frame failure could not be retained; original intent remains unsettled."); }
    finally {
      active.child?.send(active.launch.kind === "attached" ? { kind: "candidate.stop", operationId: id } : { kind: "stop" });
      active.reject(new MoguriError("candidate_transport_partial", diagnostic, 409));
    }
  }
  recover(): EventInput[] {
    return this.records().filter((record) => record.status === "running").map((record) => this.event(projectCandidateTransport(record, {
      ...record, revision: record.revision + 1, status: "partial", diagnostic: "Control plane restarted. Original caller-owned worker intent and possible effects remain retained; no read/write/model/test was replayed.",
    })));
  }
}
