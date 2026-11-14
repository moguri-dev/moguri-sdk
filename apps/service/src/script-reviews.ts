import { randomUUID } from "node:crypto";
import {
  MoguriError, isRecord, parse, type EventInput, type ModelAdviceSource, type Session, type Snapshot, type StoredEvent, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import {
  SCRIPT_REVIEW_MAX_BYTES, ScriptExecutionResultSchema, scriptSourceUrl, type NativeScriptSource, type RunScriptTool, type ScriptExecution, type ScriptExecutionResult, type ScriptReviewCommand, type ScriptReviewQuery,
  type ScriptReviewRecord, type ScriptReviewResponse, type ScriptReviewTool,
} from "../../../packages/protocol/src/script-reviews.ts";
import { assertFolderAccess, type FolderPolicy } from "./project-policy.ts";
import { readProjectFile } from "./files.ts";
import { sourceRoot } from "./repository-source.ts";
import { digest, type EventStore } from "./store.ts";
import { fetchPublicSource } from "./web-page.ts";
import { assertWebAccess, type WebAccess } from "../../../packages/protocol/src/web-policy.ts";
import { COMPLETE_SOURCE_ENVELOPE_BYTES } from "../../../packages/protocol/src/skill-admission.ts";

export interface ScriptReviewScope {
  root: string | null; repositoryProjectId: string | null; folders: FolderPolicy;
  native?: { workspaceId: string; inputDigest: string; configurationDigest: string; workerDigest: string; guestRoot: string; executionId?: string };
}
export interface ScriptReviewHost {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  commit(events: EventInput[]): void;
  scope(session: Session, path: string, repository?: string): ScriptReviewScope;
}
export interface ScriptReviewOptions { fetchSource?: typeof fetchPublicSource }
const warning = "Agent safety assessments are untrusted advice, not a safety guarantee or permission. Unsafe advice blocks execution approval until an actual user forces this exact source. Hard policy, source/root checks and normal tool approval still apply.";
export class ScriptReviews {
  constructor(private readonly store: EventStore, private readonly host: ScriptReviewHost, private readonly options: ScriptReviewOptions = {}) {}
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("script_review_scope", "The original script session is unavailable in this profile.", 404);
    return session;
  }
  private current(sessionId: string, id: string): ScriptReviewRecord {
    this.session(sessionId);
    const record = this.host.snapshot().scriptReviews.find((record) => record.id === id && record.sessionId === sessionId && record.profileId === this.host.snapshot().profileId);
    if (!record) throw new MoguriError("script_review_scope", "This script review is not retained in the exact session/profile.", 404);
    return record;
  }
  private event(review: ScriptReviewRecord): EventInput {
    return { event_type: "script.review_recorded", profile_id: review.profileId, project_id: review.projectId, session_id: review.sessionId,
      ...(review.nativeExecution ? { turn_id: review.nativeExecution.turnId, step_id: review.nativeExecution.stepId } : {}), payload: { review } };
  }
  private async binding(session: Session, path: string, repository: string | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    const state = this.host.snapshot();
    if (!["Local", "Sandbox"].includes(session.controls.env) || !state.policy.allowedEnvs.includes(session.controls.env)) throw new MoguriError("script_review_env", "Full-source scripts require their actual allowed Local or qualified Sandbox owner. Remote and environment fallback remain blocked.", 403);
    const scope = this.host.scope(session, path, repository);
    if ((session.controls.env === "Sandbox") !== Boolean(scope.native)) throw new MoguriError("script_review_env", "The actual script environment has no matching owned root transport. No Local source or replacement stage was used.", 403);
    if (!scope.root) throw new MoguriError("script_review_root", "Bind an actual workspace or captured Home before inspecting a script.", 403);
    const root = scope.root, binding = await sourceRoot(root);
    const policy = () => {
      const current = this.session(session.id), snapshot = this.host.snapshot(), actual = this.host.scope(current, path, repository);
      const native = actual.native;
      return digest(JSON.stringify([snapshot.profileId, current.id, current.projectId, current.workspaceId, current.mode, current.pendingMode,
        current.controls.env, actual.root, actual.repositoryProjectId, actual.folders, snapshot.settings.permissionRevision, snapshot.policy.revision, binding,
        ...(native ? [{ workspaceId: native.workspaceId, inputDigest: native.inputDigest, configurationDigest: native.configurationDigest,
          workerDigest: native.workerDigest, guestRoot: native.guestRoot }] : [])]));
    };
    const policyDigest = policy(), check = async () => {
      signal.throwIfAborted();
      if (JSON.stringify(await sourceRoot(root)) !== JSON.stringify(binding) || policy() !== policyDigest) throw new MoguriError("script_review_stale", "The actual script root, mode or policy changed during inspection. No replacement source was accepted.", 409);
    };
    return { scope: { ...scope, root: scope.root }, policyDigest, rootDigest: digest(JSON.stringify(binding)), check };
  }
  private async source(session: Session, path: string, repository: string | undefined, signal: AbortSignal) {
    const captured = await this.binding(session, path, repository, signal), { scope } = captured;
    await assertFolderAccess(scope.root, path, false, scope.folders);
    const file = await readProjectFile(scope.root, path, SCRIPT_REVIEW_MAX_BYTES);
    await captured.check();
    return { ...captured, file, url: undefined, resolvedUrl: undefined };
  }
  private async validate(record: ScriptReviewRecord, signal: AbortSignal) {
    const session = this.session(record.sessionId);
    if (session.projectId !== record.projectId || session.workspaceId !== record.workspaceId) throw new MoguriError("script_review_stale", "The script session no longer has its original project/workspace.", 409);
    const fileSource = record.source.url ? null : await this.source(session, record.source.path, record.repositoryProjectId ?? undefined, signal);
    const source = fileSource ?? await this.binding(session, ".", record.repositoryProjectId ?? undefined, signal), native = source.scope.native;
    if (native && !this.host.snapshot().sandboxExecutions?.some((execution) => execution.sessionId === session.id &&
      execution.turnId === record.turnId && execution.workspaceId === native.workspaceId &&
      execution.inputDigest === native.inputDigest && execution.workerDigest === native.workerDigest)) {
      throw new MoguriError("script_review_owner", "The original native inspection execution is not retained under this exact stage and build. No replacement guest or source was adopted.", 409);
    }
    if (fileSource && (fileSource.file.digest !== record.source.digest || fileSource.file.path !== record.source.path) || source.rootDigest !== record.source.rootDigest ||
      source.scope.root !== record.root || source.policyDigest !== record.policyDigest) throw new MoguriError("script_review_stale", "The exact inspected script bytes, root, mode or policy changed. Ask the agent to inspect the complete new source; force cannot override this check.", 409);
    await source.check();
    return source;
  }
  private text(record: ScriptReviewRecord): string {
    const text = this.store.blob(record.source.digest);
    if (digest(text) !== record.source.digest || Buffer.byteLength(text) !== record.source.bytes) throw new MoguriError("script_review_source", "The original full script source is unavailable or corrupt. No filesystem or network replacement was used.", 409);
    return text;
  }
  async tool(session: Session, input: ScriptReviewTool, origin: ModelAdviceSource, turnId: string, signal: AbortSignal, repository?: string, access?: WebAccess, nativeSource?: NativeScriptSource) {
    if (session.turnId !== turnId) throw new MoguriError("script_review_owner", "Only the actual owning model turn can inspect or assess a script.", 409);
    if (input.action === "inspect") {
      const source = "url" in input ? await (async () => {
        const url = scriptSourceUrl(input.url);
        assertWebAccess(access, url.href);
        const captured = await this.binding(session, ".", repository, signal);
        let result: NativeScriptSource;
        if (captured.scope.native) {
          if (!nativeSource) throw new MoguriError("script_review_transport", "The complete public source must come from its original native guest. No controller network fallback was used.", 403);
          result = nativeSource;
        } else {
          if (nativeSource) throw new MoguriError("script_review_transport", "A guest source cannot replace the original Local reader.", 403);
          result = await (this.options.fetchSource ?? fetchPublicSource)(input.url, signal, 0, access, SCRIPT_REVIEW_MAX_BYTES);
        }
        const resolved = scriptSourceUrl(result.url);
        assertWebAccess(access, resolved.href);
        if (!result.body.isWellFormed() || result.body.includes("\0") || Buffer.byteLength(result.body) > SCRIPT_REVIEW_MAX_BYTES ||
          /text\/html/i.test(result.type)) throw new MoguriError("script_review_format", "Review only a complete bounded UTF-8 script, never an HTML/login page, binary conversion or truncated source.");
        await captured.check();
        const hash = digest(result.body), extension = input.interpreter === "node-module" ? "mjs" : input.interpreter === "node-commonjs" ? "cjs" : input.interpreter === "python3" ? "py" : "sh";
        return { ...captured, file: { path: `reviewed-${hash.slice(0, 16)}.${extension}`, digest: hash, bytes: Buffer.byteLength(result.body), text: result.body }, url: input.url, resolvedUrl: result.url };
      })() : await this.source(session, input.path, repository, signal);
      const native = source.scope.native;
      if (native) {
        const execution = this.host.snapshot().sandboxExecutions?.find((value) => value.id === native.executionId);
        if (!execution || execution.sessionId !== session.id || execution.turnId !== turnId || execution.workspaceId !== native.workspaceId ||
          !execution.nativeSessionId || !execution.planDigest || !execution.signerFingerprint || execution.cleanup !== "pending") {
          throw new MoguriError("script_review_owner", "Native inspection requires the exact authenticated active guest and its original private stage. No source was retained from another owner.", 409);
        }
      } else if (nativeSource) throw new MoguriError("script_review_transport", "A guest source cannot be substituted into a Local inspection.", 403);
      const record: ScriptReviewRecord = {
        id: randomUUID(), revision: 0, profileId: this.host.snapshot().profileId, sessionId: session.id, projectId: session.projectId,
        workspaceId: session.workspaceId, repositoryProjectId: source.scope.repositoryProjectId, root: source.scope.root!, turnId,
        inspectedAt: new Date().toISOString(), policyDigest: source.policyDigest, inspection: origin,
        source: { path: source.file.path, digest: source.file.digest, bytes: source.file.bytes, rootDigest: source.rootDigest,
          interpreter: input.interpreter, args: input.args ?? [], ...(source.url ? { url: source.url, resolvedUrl: source.resolvedUrl } : {}) },
        advice: null, force: null, attempt: null,
      };
      const result = { inspection: { id: record.id, revision: record.revision, source: record.source, repositoryProjectId: record.repositoryProjectId },
        text: source.file.text, complete: true, warning };
      if (Buffer.byteLength(JSON.stringify(result)) > COMPLETE_SOURCE_ENVELOPE_BYTES) throw new MoguriError("script_review_limit", "The complete escaped script, metadata and result exceed the 2 MiB transport envelope. Nothing was truncated or admitted; the selected model's context and normal all-role budget admission still apply.", 413);
      this.store.putBlob(source.file.text);
      signal.throwIfAborted(); this.host.commit([this.event(record)]);
      return result;
    }
    const record = this.current(session.id, input.id);
    if (record.revision !== input.expectedRevision || record.source.digest !== input.expectedDigest || record.source.path !== input.path ||
      record.turnId !== turnId || record.advice || record.force || record.attempt) throw new MoguriError("script_review_stale", "Use the original unreviewed full inspection from this exact owning turn and revision.", 409);
    const history = this.host.events(), completed = history.findLast((event) => event.event_type === "tool.completed" && event.session_id === session.id &&
      event.turn_id === turnId && event.step_id === record.inspection.stepId && event.payload.call.id === record.inspection.callId &&
      !event.payload.isError && event.payload.outcome === "completed");
    const model = history.findLast((event) => event.event_type === "model.started" && event.session_id === session.id && event.turn_id === turnId && event.step_id === origin.stepId);
    if (!completed || !model || completed.seq >= model.seq || history.some((event) => event.event_type === "context.changed" &&
      event.session_id === session.id && event.seq > completed.seq && event.seq < model.seq)) throw new MoguriError("script_review_incomplete", "The complete source was not delivered before this actual model assessment, or its context changed. Inspect it again.", 409);
    let delivered: unknown;
    try { delivered = JSON.parse(completed.event_type === "tool.completed" ? completed.payload.text : "null"); }
    catch { throw new MoguriError("script_review_incomplete", "The original source delivery did not retain a complete structured receipt. No model assessment can substitute it.", 409); }
    if (!isRecord(delivered) || delivered.complete !== true || delivered.text !== this.text(record)) throw new MoguriError("script_review_incomplete", "The actual model did not receive this entire exact script before assessing it.", 409);
    if (!input.summary.trim() || input.findings.some((finding) => !finding.trim())) throw new MoguriError("script_review_summary", "Report a concrete assessment and non-empty findings. Descriptive observations may accompany a safe verdict; unknown or suspicious behavior must be assessed as unsafe.");
    await this.validate(record, signal); signal.throwIfAborted();
    if (this.current(session.id, record.id).revision !== record.revision) throw new MoguriError("script_review_stale", "Another caller changed this exact script review.", 409);
    const next = { ...record, revision: record.revision + 1, advice: { source: origin, verdict: input.verdict, summary: input.summary, findings: input.findings } };
    this.host.commit([this.event(next)]);
    return { reviewId: next.id, revision: next.revision, source: next.source, verdict: input.verdict, summary: input.summary, findings: input.findings,
      execution: input.verdict === "unsafe" ? "Blocked. Report to the user; do not ask for execution approval. Only an explicit user force can override this advisory, never hard policy." : "No unsafe behavior identified by the agent. Normal execution policy and approval are still required.", warning };
  }
  async reserve(session: Session, call: ToolCall, input: Extract<RunScriptTool, { reviewId: string }>, owner: "model" | "user", ownerId: string, signal: AbortSignal): Promise<ScriptExecution> {
    const record = this.current(session.id, input.reviewId);
    if (record.source.digest !== input.expectedDigest || record.source.path !== input.path || !record.advice) throw new MoguriError("script_review_required", "Inspect and assess the entire exact script before requesting execution approval.", 403);
    if (record.advice.verdict === "unsafe" && (owner !== "user" || record.force?.commandId !== ownerId)) {
      throw new MoguriError("script_review_unsafe", `Unsafe script review ${record.id}: ${record.advice.summary}. ${record.advice.findings.join(" ")} No execution approval was requested. Only the actual user can force this exact revision.`, 403);
    }
    if (owner === "model" && record.turnId !== ownerId || owner === "user" && record.force?.commandId !== ownerId) throw new MoguriError("script_review_owner", "This execution does not own the original model turn or exact actual-user force.", 403);
    if (record.attempt ? record.attempt.callId !== call.id || record.attempt.owner !== owner || record.attempt.ownerId !== ownerId :
      record.revision !== input.expectedRevision) throw new MoguriError("script_review_attempt", "The original execution attempt is already retained or its review revision changed. No script was replayed.", 409);
    await this.validate(record, signal); signal.throwIfAborted();
    const current = this.current(session.id, record.id);
    if (current.revision !== record.revision) throw new MoguriError("script_review_stale", "The original review changed during admission.", 409);
    if (!record.attempt) this.host.commit([this.event({ ...record, revision: record.revision + 1, attempt: { callId: call.id, owner, ownerId } })]);
    return { reviewId: record.id, path: record.source.path, digest: record.source.digest, rootDigest: record.source.rootDigest,
      interpreter: record.source.interpreter, args: record.source.args, text: this.text(record) };
  }
  async bindNative(session: Session, call: ToolCall, stepId: string, executionId: string, guestRootDigest: string,
    owner: "model" | "user", ownerId: string, signal: AbortSignal): Promise<ScriptExecution> {
    const reviewId = call.arguments.reviewId;
    if (typeof reviewId !== "string") throw new MoguriError("script_review_required", "Sandbox execution requires the complete reviewed source, not inherited repository trust.", 403);
    const record = this.current(session.id, reviewId);
    if (record.source.digest !== call.arguments.expectedDigest || record.source.path !== call.arguments.path ||
      !record.attempt || record.attempt.callId !== call.id || record.attempt.owner !== owner || record.attempt.ownerId !== ownerId || record.nativeExecution) {
      throw new MoguriError("script_review_attempt", "This native script has no original admitted attempt, or its one root grant is already retained. No dispatch was repeated.", 409);
    }
    const source = await this.validate(record, signal), native = source.scope.native;
    const execution = this.host.snapshot().sandboxExecutions?.find((value) => value.id === executionId);
    if (!native || native.executionId !== executionId || !execution || execution.sessionId !== session.id || execution.turnId !== session.turnId ||
      execution.workspaceId !== native.workspaceId || !execution.nativeSessionId || !execution.planDigest || !execution.signerFingerprint ||
      execution.cleanup !== "pending" || this.current(session.id, record.id).revision !== record.revision) {
      throw new MoguriError("script_review_owner", "The original admitted native script lost its exact active guest, private stage or review revision. No replacement was used.", 409);
    }
    signal.throwIfAborted();
    const grant = { version: 1 as const, executionId, workspaceId: native.workspaceId, rootDigest: record.source.rootDigest, guestRootDigest };
    this.host.commit([this.event({ ...record, revision: record.revision + 1,
      nativeExecution: { ...grant, turnId: execution.turnId, stepId, resultDigest: null } })]);
    return { reviewId: record.id, path: record.source.path, digest: record.source.digest, rootDigest: record.source.rootDigest,
      interpreter: record.source.interpreter, args: record.source.args, text: this.text(record), native: grant };
  }
  retainNativeResult(sessionId: string, reviewId: string, executionId: string, callId: string, result: unknown): ScriptReviewRecord {
    const record = this.current(sessionId, reviewId), native = record.nativeExecution;
    if (!native || native.executionId !== executionId || record.attempt?.callId !== callId || native.resultDigest) {
      throw new MoguriError("script_review_result", "Only the original native script root grant can retain one exact result. No late result or missing receipt authorized another run.", 409);
    }
    const value = parse(ScriptExecutionResultSchema, result);
    if (value.outcome === "completed" && value.isError || value.outcome !== "completed" && !value.isError ||
      value.cleanupConfirmed && value.outcome !== "partial") {
      throw new MoguriError("script_review_result", "The exact native observation has contradictory completion or cleanup fields. No success or replay was inferred.", 409);
    }
    const resultDigest = this.store.putBlob(JSON.stringify(value));
    const next = { ...record, revision: record.revision + 1, nativeExecution: { ...native, resultDigest } };
    this.host.commit([this.event(next)]);
    return next;
  }
  nativeResult(sessionId: string, reviewId: string, executionId: string): ScriptExecutionResult | null {
    const native = this.current(sessionId, reviewId).nativeExecution;
    if (!native || native.executionId !== executionId || !native.resultDigest) return null;
    return parse(ScriptExecutionResultSchema, JSON.parse(this.store.blob(native.resultDigest)));
  }
  async approve(command: Extract<ScriptReviewCommand, { type: "script.review.approve" }>, commandId: string, signal: AbortSignal): Promise<EventInput> {
    const session = this.session(command.sessionId), record = this.current(session.id, command.reviewId);
    if (session.revision !== command.expectedSessionRevision || record.revision !== command.expectedRevision ||
      record.source.digest !== command.expectedDigest || record.advice?.verdict !== "safe" || record.approval || record.force) {
      throw new MoguriError("script_review_stale", "Approve only the exact current safe assessment after reading its full source. Unsafe advice requires a separate explicit force; no execution permission was granted.", 409);
    }
    await this.validate(record, signal); signal.throwIfAborted();
    if (this.session(session.id).revision !== command.expectedSessionRevision || this.current(session.id, record.id).revision !== record.revision ||
      this.current(session.id, record.id).approval) throw new MoguriError("script_review_stale", "The exact session/review changed during approval. Read the current assessment before deciding again.", 409);
    return { event_type: "script.review_approved", profile_id: record.profileId, project_id: record.projectId, session_id: record.sessionId,
      payload: { approval: { reviewId: record.id, reviewRevision: record.revision, sourceDigest: record.source.digest,
        actor: "user", commandId, at: new Date().toISOString() } } };
  }
  async force(command: Extract<ScriptReviewCommand, { type: "script.review.force" }>, commandId: string, signal: AbortSignal): Promise<ToolCall> {
    const session = this.session(command.sessionId), record = this.current(session.id, command.reviewId);
    if (session.revision !== command.expectedSessionRevision || record.revision !== command.expectedRevision || record.source.digest !== command.expectedDigest ||
      !record.advice || record.advice.verdict !== "unsafe" || record.force || record.attempt) throw new MoguriError("script_review_stale", "Force only one exact original unsafe review with the current session/review revisions. Missing receipts or prior force attempts never authorize replay.", 409);
    await this.validate(record, signal); signal.throwIfAborted();
    if (this.session(session.id).revision !== command.expectedSessionRevision || this.current(session.id, record.id).revision !== record.revision) throw new MoguriError("script_review_stale", "The exact session/review changed during the user's force request.", 409);
    const next = { ...record, revision: record.revision + 1, force: { actor: "user" as const, commandId, at: new Date().toISOString() } };
    this.host.commit([this.event(next)]);
    return { id: randomUUID(), name: "run_script", arguments: { path: record.source.path, reviewId: record.id,
      expectedRevision: next.revision, expectedDigest: record.source.digest, ...(record.repositoryProjectId ? { repository: record.repositoryProjectId } : {}) } };
  }
  read(query: ScriptReviewQuery): ScriptReviewResponse {
    const review = this.current(query.sessionId, query.reviewId);
    return { type: query.type, review, text: this.text(review), warning,
      ...(review.nativeExecution ? { executionResult: this.nativeResult(review.sessionId, review.id, review.nativeExecution.executionId) } : {}) };
  }
}
