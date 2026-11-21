import type { Message } from "@earendil-works/pi-ai";
import {
  activeDecision, decisionEvidence, DecisionDocumentSchema, MoguriError, parse, projectDecision, successfulRoleEntry,
  ordinarySolverStep, decisionCleanup,
  type CommandResult, type DecisionCommand, type DecisionDocument, type DecisionQuery, type DecisionQuestions, type DecisionRecord, type DecisionResponse,
  type DecisionSource, type EventInput, type RetainedArtifact, type Session, type Snapshot, type StoredEvent, type Usage, type BudgetLimit,
  type OwnedModelTransport,
} from "../../../packages/protocol/src/index.ts";
import { decisionAdvice, decisionState } from "./decision-contracts.ts";
import { decisionCapability } from "./decision-policy.ts";
import { estimateModelContext, modelRequest } from "./model-controls.ts";
import { reportedModelUsage, modelOutputExceeded, type BudgetRuntime } from "./budgets.ts";
import type { ModelRegistry } from "./model-registry.ts";
import type { RepositoryTelemetry } from "./repository-telemetry.ts";
import { digest, type EventStore } from "./store.ts";
import { localWorker, type WorkerConnection } from "./worker-connection.ts";
import { assistantMessage, WorkerRequestSchema, type ParentMessage, type WorkerRequest } from "./worker-protocol.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { authorizeTool } from "./permissions.ts";
import { sourceRootSync } from "./repository-source.ts";
import type { PreparedModel } from "./provider.ts";

interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; commit(events: EventInput[]): void;
  budgets: BudgetRuntime; models: ModelRegistry; repositories: RepositoryTelemetry;
  current(sessionId: string, turnId: string): boolean; projectRevision(session: Session): number;
  root(sessionId: string): string | null;
  globalLimit(): BudgetLimit | null;
  artifact(session: Session, text: string): RetainedArtifact;
  usage(sessionId: string, request: Extract<WorkerRequest, { kind: "model.complete" }>): Usage;
  transport(session: Session): OwnedModelTransport;
  ownedWorker(session: Session, ownerId: string, source: DecisionSource, request: (request: WorkerRequest) => Promise<void>): WorkerConnection;
  prepareModel(session: Session, modelId: string, signal: AbortSignal): Promise<PreparedModel>;
}
interface Live {
  id: string; child: WorkerConnection; abort: AbortController; chain: Promise<void>; exited: boolean; finished: boolean;
  promise: Promise<DecisionRecord | null>; resolve(value: DecisionRecord | null): void; reject(error: Error): void;
  deadline?: ReturnType<typeof setTimeout>; stopTimer?: ReturnType<typeof setTimeout>; killTimer?: ReturnType<typeof setTimeout>;
  detach(): void; error?: Error;
}
const now = () => new Date().toISOString();
export class Decisions {
  private readonly live = new Map<string, Live>();
  constructor(private readonly store: EventStore, private readonly workerPath: string, private readonly host: Host) {}
  capability(env: Session["controls"]["env"]) { const state = this.host.snapshot(); return decisionCapability(state.settings.values.decisions, state.provider.models, env); }
  event(decision: DecisionRecord): EventInput { return { event_type: "decision.recorded", profile_id: decision.profileId, payload: { decision } }; }
  owns(sessionId: string): boolean { return [...this.live.keys()].some((id) => this.record(id).sessionId === sessionId); }
  record(id: string): DecisionRecord {
    const state = this.host.snapshot(), record = state.decisions.find((record) => record.id === id), artifact = state.artifacts.find((artifact) => artifact.id === id);
    if (!record || !artifact) throw new MoguriError("decision_missing", "Decision report is deleted, missing or outside this immutable profile.", 404);
    if (artifact.kind !== "report" || artifact.contentDigest !== record.inputDigest) throw new MoguriError("decision_corrupt", "The original decision request/provenance was replaced. No substitute.", 409);
    return record;
  }
  document(record: DecisionRecord): DecisionDocument {
    const document = parse(DecisionDocumentSchema, JSON.parse(this.store.blob(record.inputDigest)));
    if (document.sessionId !== record.sessionId || document.turnId !== record.turnId || digest(JSON.stringify(document.source)) !== record.sourceDigest ||
      JSON.stringify(document.source) !== JSON.stringify(record.source) || document.bindingDigest !== record.bindingDigest ||
      document.policyDigest !== record.policyDigest || digest(document.policyJson) !== record.policyDigest ||
      document.inputBound !== record.inputBound || document.outputBound !== record.outputBound || document.version !== record.version ||
      document.version === 2 && (record.version !== 2 || JSON.stringify(document.transport) !== JSON.stringify(record.transport))) throw new MoguriError("decision_corrupt", "Original source/owner, exact policy/model and complete decision envelope disagree. No replay.", 409);
    return document;
  }
  private policy(session: Session): string {
    const state = this.host.snapshot();
    return JSON.stringify({ profileId: state.profileId, permissionRevision: state.settings.permissionRevision, decisions: state.settings.values.decisions,
      permissions: state.settings.values.permissions, localModels: state.settings.values.localModels, allowedEnvs: state.policy,
      budgetPolicy: state.budgetPolicy, globalLimit: this.host.globalLimit(), budgets: state.settings.values.budgets, projectRevision: this.host.projectRevision(session),
      ...(session.controls.env === "Local" ? {} : { env: session.controls.env, remote: state.settings.values.remote,
        sandbox: state.settings.values.sandbox, sandboxManagement: state.settings.values.sandboxManagement }) });
  }
  private root(sessionId: string): DecisionDocument["root"] {
    const path = this.host.root(sessionId);
    try { return path === null ? null : sourceRootSync(path); }
    catch (error) {
      if (error instanceof MoguriError || error instanceof Error && "code" in error && typeof error.code === "string" &&
        ["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(error.code)) throw new MoguriError("decision_root", "The original actual canonical Local directory disappeared, became an alias or cannot be verified. No root substitution or automatic action.", 409);
      throw error;
    }
  }
  private binding(session: Session, source: DecisionSource): string {
    const state = this.host.snapshot();
    if (!session.turnId || session.controls.autonomy !== "Autopilot Max" || session.status === "stopping" ||
      !this.host.current(session.id, session.turnId) || !state.policy.allowedEnvs.includes(session.controls.env) ||
      !ordinarySolverStep(this.host.events(), state.profileId, session.id, session.turnId, source.parentStepId)) throw new MoguriError("decision_stale", "The original actual selected parent/solver, Autopilot delegation or execution boundary ended/changed. Unselected router/critic/private roles cannot adopt it; no fallback or action.", 409);
    let pending: unknown;
    if (source.kind === "tool") {
      const approval = session.pendingApproval;
      if (!approval || approval.id !== source.approvalId || approval.stepId !== source.parentStepId || approval.call.id !== source.callId ||
        digest(JSON.stringify(approval.call.arguments)) !== source.argumentsDigest || approval.policyRevision !== state.policy.revision ||
        approval.permissionRevision !== state.settings.permissionRevision) throw new MoguriError("decision_stale", "The exact tool request/arguments or human approval changed. No stale decision.", 409);
      const authorization = authorizeTool(state.settings.values, approval.call, this.host.root(session.id));
      if (!state.settings.values.decisions.reviewDelegatedTools || authorization.decision !== "allow" || authorization.ruleId !== source.delegationId)
        throw new MoguriError("decision_stale", "Only one still-existing exact actual-user delegation can receive automated tool review. Hard denials and human-only requests win.", 403);
      pending = approval;
    } else if (source.kind === "question") {
      const question = state.questions.find((question) => question.id === source.questionId);
      if (!question || question.status !== "open" || question.sessionId !== session.id || question.turnId !== session.turnId ||
        question.stepId !== source.parentStepId || question.callId !== source.callId || question.revision !== source.questionRevision ||
        session.pendingQuestionId !== question.id) throw new MoguriError("decision_stale", "The exact original question was answered, cancelled or changed. The human answer wins.", 409);
      if (question.allowFreeform || !state.settings.values.decisions.technicalQuestions.some((entry) => entry.id === source.delegationId &&
        entry.kind === "technical-choice" && entry.question === question.question && JSON.stringify(entry.choices) === JSON.stringify(question.choices)))
        throw new MoguriError("decision_stale", "Only the exact user-declared technical question and alternatives may be answered. No user-only fact or open-ended answer was inferred.", 403);
      pending = question;
    } else {
      if (!state.settings.values.decisions.steering || !state.settings.values.decisions.steeringChoices.length || source.delegationId !== "user-configured-steering" ||
        session.queueRevision !== source.queueRevision || session.pendingMode || session.pendingApproval || session.pendingQuestionId ||
        session.queue.some((item) => item.delivery === "steer" && item.targetTurnId === session.turnId)) throw new MoguriError("decision_stale", "Human queued work, a mode change or a pending interaction wins over automated steering.", 409);
      pending = source;
    }
    return digest(JSON.stringify({ sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId, turnId: session.turnId,
      root: session.controls.env === "Local" ? this.root(session.id) : null,
      ...(session.controls.env === "Local" ? {} : { transport: this.host.transport(session) }),
      controls: session.controls, mode: session.mode, pendingMode: session.pendingMode, queueRevision: session.queueRevision, pending }));
  }
  private checked(id: string) {
    const record = this.record(id), document = this.document(record), state = this.host.snapshot(), session = state.sessions.find((session) => session.id === record.sessionId);
    if (!session || session.turnId !== record.turnId || this.policy(session) !== document.policyJson || this.binding(session, record.source) !== record.bindingDigest)
      throw new MoguriError("decision_stale", "The exact original request/context/delegation/policy changed or the human intervened. No stale model action.", 409);
    if (record.version === 2 && JSON.stringify(record.transport) !== JSON.stringify(this.host.transport(session))) {
      throw new MoguriError("decision_transport", "The actual original peer/root/guest transport changed. No controller or replacement worker was adopted.", 409);
    }
    const capability = this.capability(session.controls.env);
    const accounting = this.host.budgets.status(session.id, capability.model.id);
    if (accounting.diagnostics.length) throw new MoguriError("decision_budget", accounting.diagnostics.join(" "), 409);
    if (JSON.stringify(capability.model) !== document.modelJson || capability.systemPrompt !== document.systemPrompt) throw new MoguriError("decision_model", "The exact configured decision model/capacity changed. No alias replacement or fallback.", 409);
    return { record, document, session, capability };
  }
  private context(document: DecisionDocument): Message[] {
    return [{ role: "user", content: JSON.stringify({ state: document.state, questions: document.questions }), timestamp: 0 }];
  }
  async evaluate(sessionId: string, source: DecisionSource, state: unknown, questions: DecisionQuestions, signal: AbortSignal): Promise<DecisionRecord | null> {
    signal.throwIfAborted();
    const snapshot = this.host.snapshot(), session = snapshot.sessions.find((session) => session.id === sessionId);
    if (!session?.turnId) throw new MoguriError("decision_owner", "Only an actual active parent owns a decision. No stand-alone inference or approval.", 409);
    const sourceDigest = digest(JSON.stringify(source)), existing = snapshot.decisions.find((record) => record.sessionId === sessionId && record.turnId === session.turnId && record.sourceDigest === sourceDigest);
    if (existing) return this.live.get(existing.id)?.promise ?? (existing.status === "ready" ? (this.checked(existing.id), existing) : null);
    if (this.host.events().some((event) => event.event_type === "artifact.deleted" && event.payload.decisionIntent?.sessionId === sessionId &&
      event.payload.decisionIntent.turnId === session.turnId && event.payload.decisionIntent.sourceDigest === sourceDigest)) throw new MoguriError("decision_deleted", "This exact original decision intent was deleted. Missing reports cannot authorize another paid call.", 409);
    const capability = this.capability(session.controls.env), policyJson = this.policy(session), bindingDigest = this.binding(session, source);
    const calls = snapshot.budgetEntries.filter((entry) => entry.sessionId === session.id && entry.turnId === session.turnId && ["decision", "steering"].includes(entry.role)).length +
      snapshot.decisions.filter((record) => record.sessionId === session.id && record.turnId === session.turnId && record.stepId === null).length;
    if (calls >= capability.settings.maxCallsPerTurn) throw new MoguriError("decision_call_limit", "This parent reached its explicit total decision/steering call bound. Ask the actual user; no paid retry or limit reset.", 409);
    const text = decisionState(state);
    const origin = session.controls.env === "Local" ? { version: 1 as const, root: this.root(session.id) } :
      { version: 2 as const, root: null, transport: this.host.transport(session) };
    const document: DecisionDocument = { format: "moguri-owned-decision", ...origin, sessionId, turnId: session.turnId, source, state: text, questions,
      settings: capability.settings, modelJson: JSON.stringify(capability.model), systemPrompt: capability.systemPrompt, inputBound: 0, outputBound: capability.settings.outputTokens,
      bindingDigest, policyDigest: digest(policyJson), policyJson };
    document.inputBound = estimateModelContext({ systemPrompt: document.systemPrompt, messages: this.context(document), tools: [] });
    parse(DecisionDocumentSchema, document);
    if (document.inputBound + document.outputBound + 4096 >= capability.model.contextWindow) throw new MoguriError("decision_context", "The whole named request/output cannot fit the actual model window. Nothing was truncated, substituted or approved.", 409);
    const artifact = this.host.artifact(session, JSON.stringify(document)), owner = this.host.budgets.owner(session), timestamp = now();
    const boundary = session.controls.env === "Local" ? { version: 1 as const, env: "Local" as const } :
      { version: 2 as const, env: session.controls.env, transport: this.host.transport(session) };
    const record: DecisionRecord = { ...boundary, id: artifact.id, profileId: snapshot.profileId, sessionId, turnId: session.turnId, ownerSessionId: owner.id,
      ownerTurnId: owner.id === session.id ? session.turnId : owner.turnId, projectId: session.projectId, workspaceId: session.workspaceId, kind: source.kind, source, sourceDigest,
      bindingDigest, policyDigest: document.policyDigest, inputDigest: artifact.contentDigest, modelId: capability.model.id, providerId: capability.model.providerId, apiModelId: capability.model.apiModelId,
      role: source.kind === "steering" ? "steering" : "decision", inputBound: document.inputBound, outputBound: document.outputBound,
      revision: 0, createdAt: timestamp, updatedAt: timestamp, status: "pending", stepId: null, actualInputDigest: null, resultDigest: null, adviceDigest: null, modelOutcome: null,
      workerOutcome: null, cancellation: "none", cleanup: "pending", applied: null, diagnostic: null };
    projectDecision(undefined, record);
    this.host.commit([{ event_type: "artifact.revised", profile_id: snapshot.profileId, project_id: session.projectId, payload: { artifact } }, this.event(record)]);
    let resolve!: Live["resolve"], reject!: Live["reject"];
    const promise = new Promise<DecisionRecord | null>((done, fail) => { resolve = done; reject = fail; });
    let live: Live;
    let child: WorkerConnection;
    try {
      signal.throwIfAborted();
      child = record.version === 1 ? localWorker(this.workerPath, record.id) : this.host.ownedWorker(session, record.id, source, async (request) => {
        const work = live.chain.then(() => this.message(live, request));
        live.chain = work.catch((error: unknown) => {
          live.error = error instanceof Error ? error : new Error("Owned model transport failed.");
          console.error("Owned decision exchange failed:", error instanceof MoguriError ? error.code : "decision_transport");
          // Cancellation writes must not create a receipt for the failed source transaction.
          this.abort(live);
        });
        await work;
      });
    } catch (error) {
      console.error("Original decision transport could not be admitted:", error instanceof MoguriError ? error.code : "decision_transport");
      this.update(record, { status: "rejected", diagnostic: error instanceof MoguriError ? error.message :
        "The original decision transport could not start. Its retained intent was not replayed and no fallback was selected." });
      return null;
    }
    live = { id: record.id, child, abort: new AbortController(), chain: Promise.resolve(), exited: false, finished: false,
      promise, resolve, reject, detach: () => signal.removeEventListener("abort", cancelled) };
    const cancelled = () => { try { this.cancel(record.id, "The actual parent or human intervention cancelled this advice. No result can authorize an action."); } catch (error) { this.persistence(live, error); } };
    this.live.set(record.id, live);
    signal.addEventListener("abort", cancelled, { once: true });
    child.events.on("stderr", (text) => { if (text.trim()) console.error("Owned decision worker reported a transport/runtime diagnostic."); });
    child.events.on("message", (raw) => {
      live.chain = live.chain.then(() => this.message(live, parse(WorkerRequestSchema, raw))).catch((error: unknown) => {
        live.error = error instanceof Error ? error : new Error("Owned decision exchange failed.");
        console.error("Owned decision exchange failed:", error instanceof MoguriError ? error.code : "decision_worker");
        cancelled();
      });
    });
    child.events.on("error", (error) => { live.error = error; cancelled(); });
    child.events.once("exit", (code, signal) => {
      live.exited = true;
      live.chain = live.chain.then(() => this.exit(live, code, signal)).catch((error: unknown) => this.persistence(live, error));
    });
    live.deadline = setTimeout(() => { try { this.cancel(record.id, "The explicit bounded decision deadline expired. No retry or automatic answer; real/unknown charges remain retained."); } catch (error) { this.persistence(live, error); } }, capability.settings.timeoutMs);
    if (signal.aborted) cancelled();
    else this.send(live, { kind: "start", root: null, context: [], readOnly: true, env: record.env });
    return promise;
  }
  private send(live: Live, message: ParentMessage): void {
    if (live.child.connected) live.child.send(message, (error) => { if (error && !live.exited) { live.error = error; this.abort(live); } });
  }
  private abort(live: Live): void {
    if (live.abort.signal.aborted) return;
    live.abort.abort(); this.send(live, { kind: "stop" });
    live.stopTimer = setTimeout(() => {
      if (!live.exited) live.child.kill("SIGTERM");
      live.killTimer = setTimeout(() => { if (!live.exited) live.child.kill("SIGKILL"); }, 1000);
    }, 5000);
  }
  cancel(id: string, diagnostic: string): void {
    const live = this.live.get(id);
    if (!live || live.exited || live.abort.signal.aborted) return;
    try {
      const record = this.record(id);
      if (activeDecision(record) && record.cancellation === "none") this.update(record, { cancellation: "requested", diagnostic });
    } finally { this.abort(live); }
  }
  cancelSession(id: string): void {
    for (const live of this.live.values()) if (this.record(live.id).sessionId === id) this.cancel(live.id, "The actual parent stopped/ended. No decision action or paid continuation was authorized.");
  }
  invalidate(): void {
    for (const live of this.live.values()) if (!live.abort.signal.aborted && !live.exited && !live.finished) {
      try { this.checked(live.id); } catch (error) {
        if (!(error instanceof MoguriError)) throw error;
        try { this.cancel(live.id, error.message); } catch (failure) { this.persistence(live, failure); }
      }
    }
    for (const record of this.host.snapshot().decisions.filter((record) => record.status === "ready" && !this.live.has(record.id))) {
      try { this.checked(record.id); }
      catch (error) { if (!(error instanceof MoguriError)) throw error; this.reject(record.id, error.message); }
    }
  }
  private update(record: DecisionRecord, changes: Partial<DecisionRecord>, effects: EventInput[] = []): DecisionRecord {
    const next = projectDecision(record, { ...record, ...changes, revision: record.revision + 1, updatedAt: now() });
    this.host.commit([this.event(next), ...effects]); return next;
  }
  private async message(live: Live, request: WorkerRequest): Promise<void> {
    if (live.finished && request.kind !== "ack") throw new MoguriError("decision_worker", "This exact one-shot decision worker already ended. No extra operation.", 409);
    if (request.kind === "ack") {
      if (!live.abort.signal.aborted) throw new MoguriError("decision_worker", "Unexpected decision cancellation acknowledgement.", 409);
      const record = this.record(live.id);
      if (activeDecision(record)) this.update(record, { cancellation: "acknowledged" });
      return;
    }
    if (request.kind === "finished") {
      const record = this.record(live.id); live.finished = true;
      this.update(record, { workerOutcome: request.outcome });
      this.send(live, { kind: "reply", requestId: request.requestId, value: { accepted: true } }); return;
    }
    if (request.kind === "delta") {
      const record = this.record(live.id);
      if (!record.stepId || record.stepId !== request.stepId || record.resultDigest) throw new MoguriError("decision_worker", "Unexpected decision stream owner.", 409);
      return;
    }
    if (request.kind === "boundary") {
      try {
        let checked = this.checked(live.id); live.abort.signal.throwIfAborted();
        if (checked.record.status !== "pending" || checked.record.stepId) throw new MoguriError("decision_replay", "Only one original bounded decision call is allowed.", 409);
        const prepared = await this.host.prepareModel(checked.session, checked.record.modelId, live.abort.signal);
        checked = this.checked(live.id); live.abort.signal.throwIfAborted();
        if (prepared.model.id !== checked.record.apiModelId || prepared.model.contextWindow !== checked.capability.model.contextWindow || prepared.model.maxTokens !== checked.capability.model.maxTokens) throw new MoguriError("decision_model", "Prepared decision identity/capacity differs from the exact configured model. No fallback.", 409);
        const context = this.context(checked.document), configured = modelRequest({ ...prepared.model, maxTokens: checked.record.outputBound }, undefined,
          { systemPrompt: checked.document.systemPrompt, messages: context, tools: [] }, checked.capability.model);
        if (configured.estimatedTokens > checked.record.inputBound || configured.maxTokens !== checked.record.outputBound) throw new MoguriError("decision_bound", "The whole original decision input/output no longer fits. No truncation or smaller silent contract.", 409);
        const attribution = await this.host.repositories.capture(checked.session, live.abort.signal);
        checked = this.checked(live.id); live.abort.signal.throwIfAborted();
        const reserved = this.host.budgets.reserve(checked.session, { stepId: request.stepId, turnId: checked.record.turnId, modelId: checked.record.modelId, providerId: checked.record.providerId,
          apiModelId: checked.record.apiModelId, role: checked.record.role, inputEstimate: configured.estimatedTokens, maxOutputTokens: checked.record.outputBound,
          repositoryCapture: this.host.repositories.finalize(checked.session, attribution) });
        if (reserved.maxTokens !== checked.record.outputBound) throw new MoguriError("decision_budget", "Current all-role capacity cannot admit the complete decision output contract plus existing finishing holds. No lifted cap or partial advice.", 409);
        const next = projectDecision(checked.record, { ...checked.record, revision: checked.record.revision + 1, updatedAt: now(), status: "running", stepId: request.stepId,
          actualInputDigest: this.store.putBlob(JSON.stringify({ systemPrompt: checked.document.systemPrompt, messages: context })) });
        this.host.commit([reserved.event, this.event(next), { event_type: "model.started", profile_id: next.profileId, project_id: next.projectId, session_id: next.sessionId, turn_id: next.turnId,
          step_id: request.stepId, payload: { modelId: next.modelId, providerId: next.providerId, apiModelId: next.apiModelId, source: checked.capability.model.source ?? "copilot",
            role: next.role, contextWindow: configured.model.contextWindow, contextEstimate: configured.estimatedTokens } }]);
        this.send(live, { kind: "reply", requestId: request.requestId, value: { ...prepared, model: { ...configured.model, maxTokens: reserved.maxTokens }, maxTokens: reserved.maxTokens,
          context, systemPrompt: checked.document.systemPrompt, phase: next.role, steers: [], tools: [], mode: "read-only", folders: { denied: [], readOnly: [] } } });
      } catch (error) {
        live.error = error instanceof Error ? error : new Error("Original decision admission failed.");
        this.send(live, { kind: "reply", requestId: request.requestId, halt: true, error: error instanceof MoguriError ? error.message : "Decision admission stopped or failed. No provider fallback or automatic answer." });
      }
      return;
    }
    if (request.kind !== "model.complete") throw new MoguriError("decision_worker", "A decision owner cannot request tools, processes, validation, another model role or workspace access.", 403);
    const record = this.record(live.id);
    if (record.status !== "running" || record.stepId !== request.stepId || record.resultDigest) throw new MoguriError("decision_result", "The actual original decision call has no pending result. No replay.", 409);
    const message = assistantMessage(request.message), usage = this.host.usage(record.sessionId, request), document = this.document(record);
    const resultDigest = this.store.putBlob(JSON.stringify({ ...message, errorMessage: message.errorMessage ? "Provider request failed." : undefined, diagnostics: undefined }));
    let adviceDigest: string | null = null, diagnostic: string | null = null;
    try {
      const entry = this.host.snapshot().budgetEntries.find((entry) => entry.id === request.stepId);
      if (message.stopReason !== "stop" || message.content.some((block) => block.type === "toolCall") || !reportedModelUsage(usage) || !entry || modelOutputExceeded(entry, usage))
        throw new MoguriError("decision_result", "Decision output is incomplete, unmetered or outside its actual positive bound. Real/unknown charges remain retained; no automatic action.", 409);
      const result = decisionAdvice(message.content.filter((block) => block.type === "text").map((block) => block.text).join(""), document.questions, document.settings.minimumConfidence, document.settings.minimumProbability);
      adviceDigest = this.store.putBlob(JSON.stringify({ answers: result.answers }));
      if (!result.eligible) diagnostic = "Decision confidence and selected probability do not separately meet the explicit thresholds, or the predicate/score cannot automatically choose. Ask the actual user.";
    } catch (error) {
      if (!(error instanceof MoguriError)) throw error;
      diagnostic = error.message;
    }
    this.update(record, { resultDigest, adviceDigest, modelOutcome: message.stopReason, diagnostic }, [{ event_type: "model.completed", profile_id: record.profileId, project_id: record.projectId,
      session_id: record.sessionId, turn_id: record.turnId, step_id: request.stepId, payload: { contextDigest: resultDigest, usage, message: {
        id: request.stepId, turnId: record.turnId, role: "notice", text: diagnostic ?? "Exact bounded decision result retained. Cleanup, original policy and human intervention are checked before any effect.",
        timestamp: new Date(message.timestamp).toISOString(), outcome: message.stopReason, toolCalls: [],
      } } }]);
    this.send(live, { kind: "reply", requestId: request.requestId, value: { accepted: true } });
  }
  private async exit(live: Live, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    const record = this.record(live.id), entry = this.host.snapshot().budgetEntries.find((entry) => entry.id === record.stepId);
    let diagnostic = record.diagnostic ?? (live.error instanceof MoguriError ? live.error.message : live.error ? "The original bounded decision transport/admission failed. No retry." : null);
    let status: DecisionRecord["status"] = "ready";
    if (live.abort.signal.aborted) diagnostic ??= "Decision cancelled or superseded. The actual human/policy wins; no automatic action.";
    if (!live.finished || code !== 0 || signal || record.workerOutcome !== "completed" || record.version === 2 && live.child.roleReleased !== true) diagnostic ??= "Original decision worker/role did not acknowledge complete bounded cleanup. No automatic result or retry.";
    if (!record.adviceDigest || !successfulRoleEntry(entry)) diagnostic ??= "The exact complete advice or known within-bound accounting is unavailable. No free/automatic action.";
    if (!diagnostic) try { this.checked(record.id); } catch (error) {
      if (!(error instanceof MoguriError)) throw error;
      diagnostic = error.message;
    }
    if (diagnostic) status = record.stepId && (!successfulRoleEntry(entry) || !live.finished || live.abort.signal.aborted) ? "partial" : "rejected";
    const cleanup = record.version === 1 || live.child.roleReleased ? decisionCleanup(record) : "unconfirmed";
    const next = this.update(record, { status, diagnostic, cleanup,
      cancellation: live.abort.signal.aborted && record.cancellation !== "acknowledged" ? "unconfirmed" : record.cancellation }, entry?.status === "reserved" ? [{
      event_type: "budget.recorded", profile_id: record.profileId, payload: { entry: { ...entry, status: "unknown", outcome: "unconfirmed",
        diagnostic: "Owned decision worker ended without acknowledged metering. Original full capacity remains held; no zero charge or retry." } },
    }] : []);
    this.release(live); live.resolve(next.status === "ready" ? next : null);
  }
  private release(live: Live): void {
    clearTimeout(live.deadline); clearTimeout(live.stopTimer); clearTimeout(live.killTimer); live.detach(); this.live.delete(live.id);
  }
  private persistence(live: Live, error: unknown): void {
    console.error("Owned decision persistence/cleanup failed:", error instanceof MoguriError ? error.code : "decision_persistence");
    live.error = error instanceof Error ? error : new Error("Owned decision persistence failed; preserve its original intent and unknown charges.");
    this.abort(live);
    if (live.exited) { this.release(live); live.reject(live.error); }
  }
  apply(id: string, choice: string, effects: EventInput[]): void {
    const { record, document } = this.checked(id);
    if (record.status !== "ready" || record.cancellation !== "none" || !record.adviceDigest || !successfulRoleEntry(this.host.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)))
      throw new MoguriError("decision_stale", "Only the original complete metered/clean advice can be considered once inside still-current delegation.", 409);
    const advice = decisionAdvice(this.store.blob(record.adviceDigest), document.questions, document.settings.minimumConfidence, document.settings.minimumProbability), answer = advice.answers.action;
    if (!advice.eligible || answer?.type !== "choice" || answer.choice !== choice || choice === "askUser") throw new MoguriError("decision_escalation", "This advice did not choose an eligible exact automatic alternative. The human interaction remains pending.", 409);
    if (!effects.length && !(record.kind === "steering" && choice === "continue") ||
      effects.some((event) => event.profile_id !== record.profileId || event.session_id !== record.sessionId || event.turn_id !== record.turnId))
      throw new MoguriError("decision_effect", "An owned decision cannot adopt another profile, parent or effect.", 409);
    const first = effects[0]!;
    if (record.source.kind === "tool") {
      if (!["allow", "deny"].includes(choice) || first.event_type !== "tool.decided" || first.payload.actor !== "decision-provider" ||
        first.payload.decisionId !== id || first.payload.approvalId !== record.source.approvalId || first.payload.ruleId !== record.source.delegationId ||
        JSON.stringify(first.payload.decisionOrigin) !== JSON.stringify(decisionEvidence(record)) ||
        first.payload.allow !== (choice === "allow") || effects.length !== (choice === "allow" ? 2 : 1) ||
        effects[1] && (effects[1].event_type !== "tool.started" || effects[1].payload.call.id !== record.source.callId ||
          digest(JSON.stringify(effects[1].payload.call.arguments)) !== record.source.argumentsDigest)) throw new MoguriError("decision_effect", "Tool advice cannot grant new permission or replace exact delegated arguments.", 409);
    } else if (record.source.kind === "question") {
      if (effects.length !== 1 || first.event_type !== "question.answered" || first.payload.questionId !== record.source.questionId ||
        first.payload.answer.actor !== "decision-provider" || first.payload.answer.decisionId !== id || first.payload.answer.modelId !== record.modelId ||
        first.payload.answer.sourceCallId !== record.stepId || document.questions.action?.type !== "choice" ||
        first.payload.answer.text !== document.questions.action.criteria[choice] || JSON.stringify(first.payload.answer.decisionOrigin) !== JSON.stringify(decisionEvidence(record)))
        throw new MoguriError("decision_effect", "Technical advice must retain its actual actor and one exact user-delegated original alternative.", 409);
    } else if (choice === "continue" ? effects.length !== 0 : effects.length !== 1 || first.event_type !== "steering.applied" || first.payload.decisionId !== id || first.payload.modelId !== record.modelId ||
      first.payload.providerId !== record.providerId || first.payload.sourceStepId !== record.stepId || document.questions.action?.type !== "choice" ||
      first.payload.text !== document.questions.action.criteria[choice] || JSON.stringify(first.payload.decisionOrigin) !== JSON.stringify(decisionEvidence(record)))
      throw new MoguriError("decision_effect", "A steer must be one exact bounded original user-configured alternative, not model-authored goal/policy expansion.", 409);
    this.update(record, { status: "applied", applied: { actor: "decision-provider", choice, effectDigest: digest(JSON.stringify(effects)), at: now() } }, effects);
  }
  reject(id: string, diagnostic: string): void { const record = this.record(id); if (record.status === "ready") this.update(record, { status: "rejected", diagnostic }); }
  recover(): EventInput[] {
    return this.host.snapshot().decisions.filter(activeDecision).map((record) => this.event(projectDecision(record, { ...record, revision: record.revision + 1, updatedAt: now(),
      status: record.status === "ready" || !record.stepId ? "rejected" : "partial", cleanup: record.cleanup === decisionCleanup(record) ? record.cleanup : "unconfirmed",
      diagnostic: "Control plane restarted with original decision intent/result. Cleanup and undisclosed usage remain unconfirmed; no advice, paid call or effect was replayed." })));
  }
  lateResult(record: DecisionRecord, resultDigest: string, modelOutcome: string): EventInput[] {
    if (record.version !== 2 || activeDecision(record) || this.live.has(record.id) || !record.stepId) {
      throw new MoguriError("decision_late_owner", "Wait for the original non-Local role to settle before inspecting its late result. No active or replacement owner was adopted.", 409);
    }
    if (record.resultDigest) {
      if (record.resultDigest !== resultDigest || record.modelOutcome !== modelOutcome) {
        throw new MoguriError("decision_late_result", "The late original result changed already retained bytes. No replacement or replay was accepted.", 409);
      }
      return [];
    }
    return [this.event(projectDecision(record, { ...record, revision: record.revision + 1, updatedAt: now(), resultDigest, modelOutcome }))];
  }
  query(query: DecisionQuery): DecisionResponse {
    if (query.type === "decisions.read") {
      const record = this.record(query.decisionId), document = this.document(record);
      return { type: query.type, decision: record, input: document, result: record.resultDigest ? this.store.blob(record.resultDigest) : null,
        advice: record.adviceDigest ? { answers: decisionAdvice(this.store.blob(record.adviceDigest), document.questions, document.settings.minimumConfidence, document.settings.minimumProbability).answers } : null };
    }
    const state = this.host.snapshot(), session = state.sessions.find((session) => session.id === query.sessionId);
    if (!session) throw new MoguriError("decision_scope", "Choose an exact existing session in this immutable profile for decision readiness.", 404);
    try {
      if (!state.policy.allowedEnvs.includes(session.controls.env)) throw new MoguriError("decision_env", "The current user-only allowed-env policy blocks this environment.", 403);
      const capability = this.capability(session.controls.env);
      const accounting = this.host.budgets.status(session.id, capability.model.id);
      if (accounting.diagnostics.length) throw new MoguriError("decision_budget", accounting.diagnostics.join(" "), 409);
      return { type: query.type, ready: true, provider: capability.settings.provider, modelId: capability.model.id, outputBound: capability.settings.outputTokens,
        reason: `Explicit bounded-model alternative at ${session.controls.env}. Tool-less advice only inside exact existing user delegation and its owned transport; confidence is not calibrated permission. This is not Jev/System One.` };
    } catch (error) {
      if (!(error instanceof MoguriError)) throw error;
      return { type: query.type, ready: false, provider: state.settings.values.decisions.provider, modelId: state.settings.values.decisions.modelId, outputBound: null, reason: error.message };
    }
  }
  execute(command: DecisionCommand, finish: WorkspaceFinish): CommandResult {
    const record = this.record(command.decisionId);
    if (record.status === "ready") {
      this.reject(record.id, "The actual user rejected this original unapplied advice. Its completed worker/accounting remain known; no effect or retry.");
      return finish([], { id: record.id });
    }
    try { this.cancel(record.id, "The actual user stopped only this original decision. The pending parent interaction still needs a human answer; no automatic retry."); }
    finally { const live = this.live.get(record.id); if (live) this.abort(live); }
    return finish([], { id: record.id });
  }
}
