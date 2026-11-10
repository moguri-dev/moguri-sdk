import { join } from "node:path";
import { Value } from "typebox/value";
import {
  CheckpointRestoreResultSchema, MoguriError, PROTOCOL_VERSION, RemoteIdentitySchema,
  type CheckpointRestorePlan, type CheckpointRestoreResult, type CheckpointWorkspace, type ProjectSettings,
  type RemoteExecution, type RemoteIdentity,
} from "../../../packages/protocol/src/index.ts";
import type { RemoteRuntime } from "./remote.ts";
import type { BridgeFrame, BridgeStatus } from "./remote-protocol.ts";
import type { WorkerConnection, WorkerFrame } from "./worker-connection.ts";
import { WorkerRequestSchema, WorkspaceRewindOperationSchema, type WorkerRequest, type WorkspaceRewindInspection, type WorkspaceRewindOperation } from "./worker-protocol.ts";
import { frameDigest, MAX_WORKER_FRAME } from "./worker-wire.ts";
import { requireRemoteCheckpointIdentity, validateRemoteRewindOperation, validateRemoteRewindPlan, verifyRemoteCheckpointWorkspace } from "./workspace-rewind-worker.ts";

export interface RemoteCheckpointScope {
  profileId: string; sessionId: string; projectId: string | null; root: string; identityDigest: string;
  target: RemoteIdentity; workerDigest: string;
}
type FileResult = CheckpointRestoreResult["files"][number];
export interface RemoteCheckpointRewindCallbacks {
  intent(execution: RemoteExecution): void | Promise<void>;
  status(execution: RemoteExecution, frame?: WorkerFrame, request?: WorkerRequest): void | Promise<void>;
  boundary(index: number, phase: "moving" | "observed", result?: FileResult): Promise<void>;
  result(result: CheckpointRestoreResult): Promise<void>;
}
type InspectionPage = Awaited<ReturnType<RemoteRuntime["inspectCandidate"]>>;
export interface RemoteCheckpointRewindInspection {
  execution: RemoteExecution; settled: boolean; result: CheckpointRestoreResult | null;
  journal: Pick<InspectionPage, "info" | "status" | "proof">; frames: BridgeFrame[]; workspace: WorkspaceRewindInspection;
  gitMatches: boolean;
  effects: Array<WorkspaceRewindInspection["files"][number] & {
    observed: FileResult | null; currentMatchesResult: boolean | null; backupMatchesOriginal: boolean | null;
  }>;
  diagnostic: string;
}
const fail = (code: string, message: string): never => { throw new MoguriError(code, `${message} No operation, model call, reset, acknowledgement or Local fallback was replayed.`, 409); };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function identity(target: RemoteIdentity): RemoteIdentity {
  return { id: target.id, name: target.name, host: target.host, port: target.port, user: target.user, hostKey: target.hostKey,
    identityFile: target.identityFile, stateDir: target.stateDir, command: [...target.command] };
}
function assertScope(runtime: RemoteRuntime, scope: RemoteCheckpointScope, ready = true): string {
  const target = ready ? runtime.assertReady() : runtime.configured();
  if (!Value.Check(RemoteIdentitySchema, identity(scope.target)) || !same(identity(target), identity(scope.target)) ||
    !/^[a-f0-9]{64}$/.test(scope.identityDigest) || !/^[a-f0-9]{64}$/.test(scope.workerDigest) ||
    !scope.profileId || scope.profileId.length > 128 || !scope.sessionId || scope.sessionId.length > 128 ||
    !scope.root.startsWith("/") || /[\u0000-\u001f\u007f]/.test(scope.root) ||
    scope.root.split("/").some((part) => part === "." || part === "..") ||
    ready && runtime.readiness.workerDigest !== scope.workerDigest) {
    return fail("rewind_scope", "The pinned peer/root/build or actual profile/session identity changed.");
  }
  return frameDigest(target);
}
const policy = (settings: ProjectSettings) => ({ deniedFolders: [...settings.deniedFolders], planPath: settings.planPath, upstream: settings.repo.upstream });
function operation(scope: RemoteCheckpointScope, operationId: string, plan: CheckpointRestorePlan, settings: ProjectSettings): WorkspaceRewindOperation {
  const value: WorkspaceRewindOperation = {
    kind: "workspace.rewind", operationId, env: "Remote", profileId: scope.profileId, sessionId: scope.sessionId, projectId: scope.projectId,
    identityDigest: scope.identityDigest, peerDigest: frameDigest({ hostKey: scope.target.hostKey }), workerDigest: scope.workerDigest,
    settings: structuredClone(settings), plan: structuredClone(plan),
  };
  if (!Value.Check(WorkspaceRewindOperationSchema, value)) return fail("rewind_operation", "The exact model-free restoration envelope is invalid.");
  validateRemoteRewindOperation(value); return value;
}
function bounded<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(signal.reason);
    signal.addEventListener("abort", stopped, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", stopped)).catch(() => {});
  });
}
function validateFileResult(plan: CheckpointRestorePlan, index: number, result: FileResult): void {
  const file = plan.files[index];
  if (!file) return fail("rewind_receipt", "An original per-file result changed its reviewed index.");
  const backup = file.choice === "restore-checkpoint" && file.current ? join(plan.root.root, ".moguri", "rewinds", plan.operationId, `${index}.displaced`) : null;
  if (result.path !== file.path || result.choice !== file.choice ||
    result.outcome !== (file.choice === "keep-current" ? "kept" : file.target ? "written" : "removed") ||
    result.digest !== (file.choice === "keep-current" ? file.current?.digest ?? null : file.target?.digest ?? null) ||
    result.backup !== backup || result.backupDigest !== (backup ? file.current!.digest : null)) {
    return fail("rewind_receipt", "An original per-file result changed its exact bytes, disposition or displaced path.");
  }
}
function validateResult(plan: CheckpointRestorePlan, result: CheckpointRestoreResult, observed: FileResult[]): void {
  if (!Value.Check(CheckpointRestoreResultSchema, result) || result.operationId !== plan.operationId ||
    !same(result.root, plan.root) || result.sourceDigest !== plan.expectedWorkspaceDigest || !same(result.git, plan.expectedGit) ||
    result.files.length !== plan.files.length || !same(result.files, observed)) {
    return fail("rewind_receipt", "The complete original restoration result lost its exact source, Git intent or observed file set.");
  }
  result.files.forEach((file, index) => validateFileResult(plan, index, file));
}

export async function captureRemoteCheckpoint(runtime: RemoteRuntime, scope: RemoteCheckpointScope, settings: ProjectSettings,
  signal: AbortSignal): Promise<CheckpointWorkspace> {
  signal.throwIfAborted();
  const configurationDigest = assertScope(runtime, scope), settingsDigest = frameDigest(settings), scopeDigest = frameDigest(scope);
  const response = await runtime.readWorkspace(scope.root, { query: { type: "checkpoint.capture" }, policy: policy(settings) }, signal);
  signal.throwIfAborted();
  if (assertScope(runtime, scope) !== configurationDigest || frameDigest(settings) !== settingsDigest || frameDigest(scope) !== scopeDigest ||
    response.type !== "checkpoint.capture") return fail("rewind_capture_stale", "The exact peer, settings or response changed while capturing its complete workspace.");
  const raw = verifyRemoteCheckpointWorkspace(response.workspace, scope.root), { digest: sourceDigest, ...source } = raw;
  const peerDigest = frameDigest({ hostKey: scope.target.hostKey });
  const value = { ...source, roots: source.roots.map((root) => ({ ...root, repositoryId: scope.projectId,
    key: scope.projectId ? `project:${scope.projectId}` : `remote:${peerDigest}:${scope.root}` })),
    boundary: { version: 1 as const, env: "Remote" as const, profileId: scope.profileId, sessionId: scope.sessionId,
      identityDigest: scope.identityDigest, peerDigest, workerDigest: scope.workerDigest, sourceDigest,
      transportDigest: frameDigest({ env: "Remote", target: identity(scope.target), workerDigest: scope.workerDigest,
        profileId: scope.profileId, sessionId: scope.sessionId, projectId: scope.projectId, root: scope.root, settingsDigest }) } };
  return { ...value, digest: frameDigest(value) };
}

export async function runRemoteCheckpointRewind(runtime: RemoteRuntime, scope: RemoteCheckpointScope, operationId: string,
  plan: CheckpointRestorePlan, settings: ProjectSettings, signal: AbortSignal, callbacks: RemoteCheckpointRewindCallbacks):
  Promise<{ execution: RemoteExecution; result: CheckpointRestoreResult }> {
  signal.throwIfAborted();
  const configurationDigest = assertScope(runtime, scope), settingsDigest = frameDigest(settings), scopeDigest = frameDigest(scope), planDigest = frameDigest(plan);
  const owned = operation(scope, operationId, plan, settings), operationDigest = frameDigest(owned);
  const execution: RemoteExecution = { id: operationId, sessionId: scope.sessionId, projectId: scope.projectId, turnId: operationId,
    target: identity(scope.target), workspace: scope.root, workerDigest: scope.workerDigest, configDigest: configurationDigest,
    createdAt: new Date().toISOString(), status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null };
  const current = () => {
    signal.throwIfAborted();
    if (assertScope(runtime, scope) !== configurationDigest || frameDigest(settings) !== settingsDigest ||
      frameDigest(scope) !== scopeDigest || frameDigest(plan) !== planDigest) {
      return fail("rewind_scope", "Original peer/build/settings changed before the next effect-authorizing boundary.");
    }
    validateRemoteRewindPlan(plan, scope.root, settings);
  };
  await callbacks.intent(structuredClone(execution)); current();
  const done = Promise.withResolvers<void>(), exit = Promise.withResolvers<void>();
  const lifetime = AbortSignal.timeout(150_000);
  let child: WorkerConnection | undefined, failure: Error | undefined, result: CheckpointRestoreResult | undefined;
  let terminal: Extract<WorkerRequest, { kind: "finished" }> | undefined, intent = false, moving = false, nextIndex = 0, bytes = 0;
  let chain = Promise.resolve(), ended = false, stopping = false, killing: ReturnType<typeof setTimeout> | undefined;
  const observed: FileResult[] = [];
  const send = (message: Parameters<WorkerConnection["send"]>[0]) => new Promise<void>((resolve, reject) => {
    if (!child?.connected) { reject(new MoguriError("rewind_control", "The original workspace worker control connection ended.", 409)); return; }
    const connection = child;
    const disconnected = () => reject(new MoguriError("rewind_control", "The original owned connection ended before acknowledging its queued message.", 409));
    connection.events.once("exit", disconnected);
    connection.send(message, (error) => { connection.events.off("exit", disconnected); if (error) reject(error); else resolve(); });
  });
  const persist = async (frame?: WorkerFrame, request?: WorkerRequest) => {
    await bounded(Promise.resolve(callbacks.status(structuredClone(execution), frame, request)), lifetime);
  };
  const stop = () => {
    if (stopping || ended) return;
    stopping = true; execution.cancellation = execution.cancellation === "none" ? "requested" : execution.cancellation;
    void send({ kind: "stop" }).catch(() => {});
    killing = setTimeout(() => child?.kill("SIGTERM"), 6500);
  };
  const failed = (error: unknown) => {
    failure ??= error instanceof Error ? error : new MoguriError("rewind_partial", "Original restoration persistence/control is unconfirmed; exact effects require inspection.", 409);
    stop();
  };
  const status = async (value: BridgeStatus) => {
    if (value.runId !== execution.id || value.acknowledged !== 0 || value.sequence < execution.lastSequence ||
      execution.workerPid !== null && value.workerPid !== execution.workerPid) {
      return fail("rewind_owner", "The actual original worker receipt changed its run/process identity.");
    }
    Object.assign(execution, { workerPid: value.workerPid, status: value.status, cancellation: value.cancellation,
      cleanup: value.cleanup, diagnostic: value.diagnostic });
    try { await persist(); }
    finally {
      if (value.cleanup === "owned-worker-stopped") {
        clearTimeout(killing);
        // Effect/terminal replies are durable acknowledgements. Keep transport frames for exact no-replay inspection.
        child?.kill("SIGTERM");
      }
    }
  };
  const frame = async (raw: unknown, receipt?: WorkerFrame) => {
    if (!Value.Check(WorkerRequestSchema, raw) || !receipt || receipt.executionId !== execution.id ||
      receipt.sequence !== execution.lastSequence + 1 || receipt.digest !== frameDigest(raw) || receipt.env !== undefined) {
      return fail("rewind_frame", "The original peer frame lost its exact authenticated owner, cursor or digest.");
    }
    bytes += Buffer.byteLength(JSON.stringify(raw)) + 256;
    if (bytes > MAX_WORKER_FRAME - 512 * 1024) return fail("rewind_limit", "Complete original restoration receipts exceeded their bounded retained journal.");
    execution.lastSequence = receipt.sequence;
    try {
      await persist(receipt, raw);
      if (raw.kind === "ack") return;
      if (terminal) return fail("rewind_frame", "An original worker requested another capability after its terminal boundary.");
      if (raw.kind === "workspace.rewind.intent") {
        if (intent || !same(raw.operation, owned)) return fail("rewind_intent", "The original worker changed or repeated its model-free restoration intent.");
        intent = true; current();
      } else if (raw.kind === "workspace.rewind.boundary") {
        if (!intent || result || raw.operationId !== operationId || raw.operationDigest !== operationDigest ||
          raw.index !== nextIndex || raw.phase !== (moving ? "observed" : "moving") ||
          raw.phase === "moving" && raw.result !== undefined || raw.phase === "observed" && !raw.result) {
          return fail("rewind_boundary", "The original per-file boundary was repeated, reordered or changed scope.");
        }
        if (raw.phase === "moving") {
          current();
          await bounded(callbacks.boundary(raw.index, raw.phase), AbortSignal.any([signal, lifetime]));
          current(); moving = true;
        } else {
          validateFileResult(plan, raw.index, raw.result!);
          await bounded(callbacks.boundary(raw.index, raw.phase, structuredClone(raw.result!)), lifetime);
          observed.push(raw.result!); moving = false; nextIndex++;
          current();
        }
      } else if (raw.kind === "workspace.rewind.complete") {
        if (!intent || result || moving || nextIndex !== plan.files.length || raw.operationId !== operationId ||
          raw.operationDigest !== operationDigest) return fail("rewind_result", "The original complete result lacks its exact per-file boundaries.");
        validateResult(plan, raw.result, observed);
        await bounded(callbacks.result(structuredClone(raw.result)), lifetime); result = raw.result; current();
      } else if (raw.kind === "finished") {
        if (raw.outcome === "completed" && (!result || moving || nextIndex !== plan.files.length)) return fail("rewind_terminal", "A completed terminal lacks its full durably retained original result.");
        terminal = raw;
      } else return fail("rewind_authority", "This model-free restoration worker requested an unrelated model, tool, hook or credential capability.");
      await send({ kind: "reply", requestId: raw.requestId, value: { accepted: true } });
    } catch (error) {
      if ("requestId" in raw) await send({ kind: "reply", requestId: raw.requestId, error: "Original user restoration boundary/result could not be durably acknowledged.", halt: true }).catch(() => {});
      failed(error);
    }
  };
  const stopped = () => failed(signal.reason ?? new Error("The original restoration was cancelled."));
  const timedOut = () => failed(new MoguriError("rewind_timeout", "The original bounded restoration timed out; effects/cleanup require exact inspection.", 409));
  signal.addEventListener("abort", stopped, { once: true }); lifetime.addEventListener("abort", timedOut, { once: true });
  try {
    child = runtime.launch(execution, (value) => { chain = chain.then(() => status(value)).catch(failed); }, true);
    child.events.on("message", (value, receipt) => { chain = chain.then(() => frame(value, receipt)).catch(failed); });
    child.events.once("error", failed);
    child.events.once("exit", () => { ended = true; clearTimeout(killing); exit.resolve(); void chain.then(done.resolve, done.reject); });
    await send({ kind: "start", root: scope.root, env: "Remote", readOnly: false, context: [], operation: owned }).catch(failed);
    if (signal.aborted) stopped();
    await done.promise; await exit.promise;
    if (execution.cleanup !== "owned-worker-stopped") {
      try {
        const inspection = await runtime.inspectCandidate(execution, 0, AbortSignal.timeout(10_000));
        if (inspection.info.root === scope.root && inspection.info.workerDigest === scope.workerDigest) await status(inspection.status);
      } catch { execution.cleanup = "unconfirmed"; execution.status = "unconfirmed"; await persist().catch(() => {}); }
    }
    if (failure || signal.aborted || !result || terminal?.outcome !== "completed" || execution.status !== "completed" ||
      execution.cleanup !== "owned-worker-stopped") {
      throw new MoguriError("rewind_partial", `Original Remote restoration remains partial/unconfirmed: ${failure?.message ?? terminal?.diagnostic ??
        "No complete retained result, terminal acknowledgement and actual owned-worker-stopped proof. Inspect it without replay."}`, 409);
    }
    current(); return { execution: structuredClone(execution), result };
  } finally {
    signal.removeEventListener("abort", stopped); lifetime.removeEventListener("abort", timedOut); clearTimeout(killing);
    if (child && !ended) { stop(); child.kill("SIGTERM"); await exit.promise; }
    await chain;
  }
}

async function originalJournal(runtime: RemoteRuntime, execution: RemoteExecution, signal: AbortSignal) {
  const frames: BridgeFrame[] = [];
  let page: InspectionPage | undefined, cursor = 0, bytes = 0;
  do {
    const next = await runtime.inspectCandidate(execution, cursor, signal);
    if (next.status.acknowledged !== 0 || next.status.runId !== execution.id || next.info.protocol !== PROTOCOL_VERSION ||
      page && next.proof !== page.proof || next.info.native || next.nextSequence !== (next.frames.at(-1)?.sequence ?? cursor)) {
      return fail("rewind_receipts", "Original complete receipts were deleted, changed during inspection or belong to another execution boundary.");
    }
    for (const frame of next.frames) {
      bytes += Buffer.byteLength(JSON.stringify(frame));
      if (frame.sequence !== ++cursor || frame.digest !== frameDigest(frame.request) || bytes > MAX_WORKER_FRAME || frames.length >= 4004) {
        return fail("rewind_receipts", "Original authenticated frames have a gap, changed digest or exceed their complete bound.");
      }
      frames.push(frame);
    }
    if (cursor < next.status.sequence && !next.frames.length) return fail("rewind_receipts", "The original journal is missing a complete frame page.");
    page = next;
  } while (cursor < page.status.sequence);
  return { page, frames };
}

export async function inspectRemoteCheckpointRewind(runtime: RemoteRuntime, execution: RemoteExecution, plan: CheckpointRestorePlan,
  settings: ProjectSettings, signal: AbortSignal): Promise<RemoteCheckpointRewindInspection> {
  signal.throwIfAborted();
  if (!execution.workspace || execution.id !== plan.operationId || execution.turnId !== execution.id) {
    return fail("rewind_inspection", "Inspection needs the retained original independent restoration identity and exact root.");
  }
  const selected = runtime.configured(), configurationDigest = frameDigest(selected), settingsDigest = frameDigest(settings);
  if (!same(identity(selected), identity(execution.target)) || configurationDigest !== execution.configDigest) {
    return fail("rewind_scope", "The original pinned target/configuration changed; another peer cannot inspect or adopt it.");
  }
  validateRemoteRewindPlan(plan, execution.workspace, settings);
  const { page, frames } = await originalJournal(runtime, execution, signal);
  const initial = frames.find((frame) => frame.request.kind !== "ack")?.request;
  if (initial?.kind !== "workspace.rewind.intent") return fail("rewind_receipts", "The original journal has no exact model-free restoration intent receipt.");
  const owned = initial.operation, operationDigest = frameDigest(owned);
  if (owned.operationId !== execution.id || owned.workerDigest !== execution.workerDigest ||
    owned.sessionId !== execution.sessionId || owned.projectId !== execution.projectId ||
    owned.peerDigest !== frameDigest({ hostKey: execution.target.hostKey }) || !same(owned.plan, plan) || !same(owned.settings, settings)) {
    return fail("rewind_inspection", "The original retained plan/source/policy, peer, session or installed worker receipt changed.");
  }
  validateRemoteRewindOperation(owned);
  if (execution.workerPid !== null && page.status.workerPid !== execution.workerPid) {
    return fail("rewind_receipts", "The actual original owned-worker receipt changed identity.");
  }
  let moving = false, nextIndex = 0, intent = false, result: CheckpointRestoreResult | null = null;
  let terminal: Extract<WorkerRequest, { kind: "finished" }> | undefined;
  const observed: FileResult[] = [];
  for (const { request } of frames) {
    if (request.kind === "ack") continue;
    if (terminal) return fail("rewind_receipts", "Another original capability followed the retained terminal receipt.");
    if (request.kind === "workspace.rewind.intent") {
      if (intent || !same(request.operation, owned)) return fail("rewind_receipts", "Original intent was repeated or changed.");
      intent = true;
    } else if (request.kind === "workspace.rewind.boundary") {
      if (result || request.operationId !== execution.id || request.operationDigest !== operationDigest ||
        request.index !== nextIndex || request.phase !== (moving ? "observed" : "moving") ||
        request.phase === "moving" && request.result || request.phase === "observed" && !request.result) {
        return fail("rewind_receipts", "Original per-file boundary receipts are incomplete, reordered or changed.");
      }
      if (request.phase === "moving") moving = true;
      else { validateFileResult(plan, request.index, request.result!); observed.push(request.result!); nextIndex++; moving = false; }
    } else if (request.kind === "workspace.rewind.complete") {
      if (result || moving || request.operationId !== execution.id || request.operationDigest !== operationDigest) return fail("rewind_receipts", "The original result changed ownership or repeated.");
      validateResult(plan, request.result, observed); result = request.result;
    } else if (request.kind === "finished") {
      if (request.outcome === "completed" && !result) return fail("rewind_receipts", "A complete terminal receipt has no original complete result.");
      terminal = request;
    }
    else return fail("rewind_authority", "An original model-free journal contains an unrelated capability.");
  }
  const fresh = await runtime.query(execution.target, { action: "workspace", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest,
    stateDir: execution.target.stateDir, root: execution.workspace, workspace: { query: { type: "checkpoint.rewind.inspect", plan }, policy: policy(settings) } }, signal);
  if (fresh.kind !== "workspace" || fresh.info.native || fresh.info.root !== execution.workspace || fresh.info.workerDigest !== execution.workerDigest ||
    fresh.result.type !== "checkpoint.rewind.inspect" || fresh.result.inspection.operationId !== execution.id ||
    !same(fresh.result.inspection.root, plan.root) || frameDigest(runtime.configured()) !== configurationDigest || frameDigest(settings) !== settingsDigest) {
    return fail("rewind_inspection", "Fresh peer file/backup evidence changed its exact original root/build/settings or response.");
  }
  const workspace = fresh.result.inspection;
  if (workspace.files.length !== plan.files.length || workspace.files.some((file, index) => file.index !== index || file.path !== plan.files[index]?.path)) {
    return fail("rewind_inspection", "Fresh inspection omitted or changed an original reviewed file.");
  }
  if (terminal && page.status.status !== "unconfirmed" && !["launching", "running", "stopping"].includes(page.status.status) &&
    page.status.status !== terminal.outcome) return fail("rewind_receipts", "Original terminal/status receipts disagree with their exact retained outcome.");
  const settled = page.status.cleanup === "owned-worker-stopped" && page.status.workerPid !== null && Boolean(terminal) &&
    !["launching", "running", "stopping"].includes(page.status.status);
  return {
    execution: { ...structuredClone(execution), status: page.status.status, cancellation: page.status.cancellation,
      cleanup: page.status.cleanup, diagnostic: page.status.diagnostic, workerPid: page.status.workerPid, lastSequence: page.status.sequence },
    settled, result, journal: { info: page.info, status: page.status, proof: page.proof }, frames, workspace,
    gitMatches: same(workspace.git, plan.expectedGit),
    effects: workspace.files.map((file, index) => {
      const observedFile = observed[index] ?? null, planned = plan.files[index]!, original = planned.current;
      const expected = planned.choice === "keep-current" ? original : planned.target;
      if (file.current) requireRemoteCheckpointIdentity(file.current);
      const originalIdentity = original ? requireRemoteCheckpointIdentity(original) : null;
      const backupIdentity = file.backup ? requireRemoteCheckpointIdentity(file.backup.file) : null;
      return { ...file, observed: observedFile,
        currentMatchesResult: observedFile ? (file.current?.digest ?? null) === observedFile.digest &&
          (file.current?.bytes ?? null) === (expected?.bytes ?? null) && (file.current?.mode ?? null) === (expected?.mode ?? null) &&
          (planned.choice !== "keep-current" || same(file.current, original)) : null,
        backupMatchesOriginal: file.backup ? Boolean(original && originalIdentity && backupIdentity && backupIdentity.device === originalIdentity.device &&
          backupIdentity.inode === originalIdentity.inode && file.backup.file.digest === original.digest &&
          file.backup.file.bytes === original.bytes && file.backup.file.mode === original.mode) : original && observedFile?.backup ? false : null };
    }),
    diagnostic: settled ? "Read-only original authenticated terminal/owned-worker-stopped proof and fresh exact peer bytes were inspected. Partial operations remain partial; no quarantine, result, user acceptance or spent budget was upgraded." :
      "The original worker/terminal receipt is unsettled or missing. Preserve its quarantine and every displaced inode; SSH end or a PID is not cleanup proof.",
  };
}
