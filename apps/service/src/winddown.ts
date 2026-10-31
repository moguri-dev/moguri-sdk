import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  ModelRoleSchema, MoguriError, parse, projectWinddown, successfulRoleEntry, WinddownDocumentSchema, WinddownCommitDocumentSchema, type CommandResult,
  type Controls, type EventInput, type Project, type RetainedArtifact, type Session, type Snapshot, type StoredEvent, type Usage, type WinddownCommand,
  type WinddownDocument, type WinddownMetadata, type WinddownQuery, type WinddownRecord, type WinddownResponse,
  type OwnedModelTransport,
} from "../../../packages/protocol/src/index.ts";
import { reportedModelUsage, modelOutputExceeded, type BudgetRuntime } from "./budgets.ts";
import { sourceRootSync } from "./repository-source.ts";
import { modelRequest } from "./model-controls.ts";
import { winddownCapability, winddownContext } from "./winddown-policy.ts";
import type { ModelRegistry } from "./model-registry.ts";
import type { RepositoryTelemetry } from "./repository-telemetry.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { digest, type EventStore } from "./store.ts";
import type { BoundaryReply } from "./worker-protocol.ts";
import { WinddownCommits, type WinddownCommitHost } from "./winddown-commits.ts";
import type { PreparedModel } from "./provider.ts";

interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; commit(events: EventInput[]): void;
  budgets: BudgetRuntime; models: ModelRegistry; repositories: RepositoryTelemetry;
  root(session: Session): Project | null; projects(): ProjectService;
  assertRoot(session: Session, signal: AbortSignal): Promise<void>; rootBusy(root: string, exceptJobId?: string): boolean;
  job: WinddownCommitHost["job"]; stopJob(id: string): void;
  artifact(session: Session, text: string): RetainedArtifact;
  stop(sessionId: string, turnId: string): void;
  scopeDigest(session: Session): string;
  transport(session: Session): OwnedModelTransport;
  prepareModel(session: Session, modelId: string, signal: AbortSignal): Promise<PreparedModel>;
}
export class Winddowns {
  private readonly commits: WinddownCommits;
  constructor(private readonly store: EventStore, private readonly host: Host) {
    this.commits = new WinddownCommits(store, { snapshot: host.snapshot, commit: host.commit, root: host.root, assertRoot: host.assertRoot, rootBusy: host.rootBusy,
      projects: host.projects, job: host.job, record: (id) => this.record(id), input: (record) => this.document(record), event: (record) => this.event(record) });
  }
  capability(controls: Controls) { return winddownCapability(this.host.snapshot().settings.values.winddown, this.host.snapshot().provider.models, controls.env); }
  event(winddown: WinddownRecord): EventInput { return { event_type: "winddown.recorded", profile_id: winddown.profileId, payload: { winddown } }; }
  forTurn(sessionId: string, turnId: string): WinddownRecord | undefined { return this.host.snapshot().winddowns.findLast((record) => record.sessionId === sessionId && record.turnId === turnId); }
  private policy(session: Session): string {
    const state = this.host.snapshot();
    return JSON.stringify({ profileId: state.profileId, sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
      env: session.controls.env, modelId: session.controls.modelId, autonomy: session.controls.autonomy, mode: session.mode, pendingMode: session.pendingMode,
      allowedEnvs: state.policy, permissionRevision: state.settings.permissionRevision, permissions: state.settings.values.permissions,
      winddown: state.settings.values.winddown, localModels: state.settings.values.localModels,
      ...(session.controls.env === "Local" ? {} : { remote: state.settings.values.remote, sandbox: state.settings.values.sandbox,
        sandboxManagement: state.settings.values.sandboxManagement }) });
  }
  prepare(session: Session, turnId: string, originId: string, taskDigest: string, extra: Parameters<BudgetRuntime["planBatch"]>[1] = []) {
    const finite = this.host.budgets.status(session.id).limits.length > 0, settings = this.host.snapshot().settings.values.winddown;
    if (!finite || !settings.enabled) return null;
    const capability = this.capability(session.controls), root = session.controls.env === "Local" ? this.host.root(session) : null;
    const source = root && session.projectId ? { projectId: session.projectId, workspaceId: session.workspaceId, ...sourceRootSync(root.path) } : null;
    const scopeDigest = session.controls.env === "Local" ? null : this.host.scopeDigest(session);
    const policyJson = this.policy(session), authorityDigest = digest(JSON.stringify({ profileId: this.host.snapshot().profileId, sessionId: session.id, turnId, source, taskDigest, policyJson,
      ...(scopeDigest ? { scopeDigest } : {}) }));
    const scope = session.controls.env === "Local" ? { version: 1 as const, source } :
      { version: 2 as const, source: null, env: session.controls.env, scopeDigest: scopeDigest! };
    const document: WinddownDocument = { format: "moguri-budget-winddown", ...scope, sessionId: session.id, turnId, taskDigest,
      settings: capability.settings, modelJson: JSON.stringify(capability.model), systemPrompt: capability.systemPrompt, inputBound: capability.inputBound,
      outputBound: capability.outputBound, authorityDigest, policyDigest: digest(policyJson), policyJson };
    parse(WinddownDocumentSchema, document);
    const text = JSON.stringify(document);
    if (Buffer.byteLength(text) > 128 * 1024 || !text.isWellFormed()) throw new MoguriError("winddown_input", "The complete original wind-down review exceeds lossless 128 KiB. No model or prefix hold was retained.", 409);
    const artifact = this.host.artifact(session, text), planId = randomUUID();
    const planned = this.host.budgets.planBatch(session, [...extra, { id: planId, turnId, role: "checkpoint", modelId: capability.model.id,
      providerId: capability.model.providerId, apiModelId: capability.model.apiModelId, authorityDigest, inputEstimate: capability.inputBound, maxOutputTokens: capability.outputBound }]);
    const plan = planned.plans.find((plan) => plan.id === planId)!;
    const origin = session.controls.env === "Local" ? { version: 1 as const, env: "Local" as const, source } :
      { version: 2 as const, env: session.controls.env, source: null, scopeDigest: scopeDigest!, transport: null };
    const now = new Date().toISOString(), record: WinddownRecord = { ...origin, id: artifact.id, profileId: this.host.snapshot().profileId, sessionId: session.id, turnId,
      ownerSessionId: plan.ownerSessionId, ownerTurnId: plan.ownerTurnId, projectId: session.projectId, workspaceId: session.workspaceId, folderId: plan.folderId,
      inputDigest: artifact.contentDigest, authorityDigest, policyDigest: document.policyDigest, originId, revision: 0, createdAt: now, updatedAt: now,
      status: "held", diagnostic: null, commitDocumentDigest: null, commit: null,
      step: { planId, role: "checkpoint", modelId: plan.modelId, providerId: plan.providerId, apiModelId: plan.apiModelId, inputBound: plan.inputBound, outputBound: plan.outputBound,
        state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null } };
    return { record, document, plans: planned.plans, events: [{ event_type: "artifact.revised" as const, profile_id: record.profileId, project_id: record.projectId, payload: { artifact } },
      ...planned.events, this.event(record)] };
  }
  record(id: string): WinddownRecord {
    const state = this.host.snapshot(), record = state.winddowns.find((record) => record.id === id), artifact = state.artifacts.find((artifact) => artifact.id === id);
    if (!record || !artifact) throw new MoguriError("winddown_missing", "Budget checkpoint is deleted, unavailable or outside this profile.", 404);
    if (artifact.kind !== "report" || artifact.contentDigest !== record.inputDigest) throw new MoguriError("winddown_corrupt", "Original checkpoint input was replaced. No substitute.", 409);
    return record;
  }
  document(record: WinddownRecord): WinddownDocument {
    const document = parse(WinddownDocumentSchema, JSON.parse(this.store.blob(record.inputDigest)));
    if (document.sessionId !== record.sessionId || document.turnId !== record.turnId || document.authorityDigest !== record.authorityDigest ||
      document.policyDigest !== record.policyDigest || digest(document.policyJson) !== record.policyDigest ||
      JSON.stringify(document.source) !== JSON.stringify(record.source) || document.inputBound !== record.step.inputBound || document.outputBound !== record.step.outputBound ||
      document.version !== record.version || document.version === 2 && (record.version !== 2 || document.scopeDigest !== record.scopeDigest ||
        document.env !== record.env)) throw new MoguriError("winddown_corrupt", "Original wind-down owner, source, policy or envelope changed. No replay.", 409);
    return document;
  }
  private checked(id: string) {
    const record = this.record(id), document = this.document(record), state = this.host.snapshot(), session = state.sessions.find((session) => session.id === record.sessionId);
    if (!session || session.turnId !== record.turnId || session.controls.env !== record.env || !state.policy.allowedEnvs.includes(record.env) ||
      session.status === "stopping" || this.policy(session) !== document.policyJson ||
      record.version === 2 && record.scopeDigest !== this.host.scopeDigest(session)) throw new MoguriError("winddown_scope", "The actual original owner, execution boundary, mode, privacy or permissions changed/stopped. No finishing fallback.", 409);
    const capability = this.capability(session.controls);
    if (JSON.stringify(capability.model) !== document.modelJson || capability.inputBound !== record.step.inputBound || capability.outputBound !== record.step.outputBound) throw new MoguriError("winddown_model", "The exact reviewed wind-down model or complete envelope changed. No replacement.", 409);
    return { record, document, session, capability };
  }
  current(id: string): void { this.checked(id); }
  private metadata(record: WinddownRecord, document: WinddownDocument): WinddownMetadata {
    const calls = this.host.snapshot().budgetEntries.filter((entry) => entry.sessionId === record.sessionId && entry.turnId === record.turnId && entry.role !== "checkpoint");
    if (calls.some((entry) => entry.status !== "settled" || entry.reportedTokens === null || entry.outputTokens === null || entry.outputTokens === undefined ||
      !Number.isSafeInteger(entry.reportedTokens) || !Number.isSafeInteger(entry.outputTokens) || entry.outputLimitViolation)) throw new MoguriError("winddown_unknown", "Ordinary work has unknown or output-violating accounting. Its full hold remains; no extra finishing model was admitted.", 409);
    const byRole = ModelRoleSchema.anyOf.map((role) => {
      const entries = calls.filter((entry) => entry.role === role.const), knownTokens = entries.reduce((sum, entry) => sum + entry.reportedTokens!, 0);
      if (!Number.isSafeInteger(knownTokens)) throw new MoguriError("winddown_metadata", "Canonical reported token aggregation exceeds safe precision. No rounded or zero-valued summary.");
      return { role: role.const, calls: entries.length, knownTokens, unknownCalls: 0 };
    });
    const origin = record.version === 1 ? { version: 1 as const, env: "Local" as const } : { version: 2 as const, env: record.env };
    return { ...origin, turnId: record.turnId, purpose: "budget-wind-down", taskDigest: document.taskDigest, calls: calls.length,
      callSetDigest: digest(JSON.stringify(calls.map(({ id, role, modelId, status, reportedTokens, outcome }) => ({ id, role, modelId, status, reportedTokens, outcome })))),
      byRole, basis: "canonical-aggregate-only-no-history-or-code" };
  }
  async boundary(id: string, stepId: string, signal: AbortSignal): Promise<BoundaryReply> {
    let checked = this.checked(id);
    if (checked.record.status !== "held" || checked.record.step.state !== "pending") throw new MoguriError("winddown_dispatched", "This exact wind-down envelope was already dispatched or ended. No replay.", 409);
    const metadata = this.metadata(checked.record, checked.document), context = winddownContext(metadata);
    const prepared = await this.host.prepareModel(checked.session, checked.record.step.modelId, signal);
    checked = this.checked(id); signal.throwIfAborted();
    const model = checked.capability.model;
    if (prepared.model.id !== model.apiModelId || prepared.model.contextWindow !== model.contextWindow || prepared.model.maxTokens !== model.maxTokens) throw new MoguriError("winddown_model", "Prepared model identity/capacity differs from its exact held wind-down binding.", 409);
    const configured = modelRequest({ ...prepared.model, maxTokens: checked.record.step.outputBound }, undefined,
      { systemPrompt: checked.document.systemPrompt, messages: context, tools: [] }, model);
    if (configured.estimatedTokens > checked.record.step.inputBound || configured.maxTokens !== checked.record.step.outputBound) throw new MoguriError("winddown_envelope", "Current complete aggregate/output exceeds the original reserved envelope. No truncation or second hold.", 409);
    const attribution = await this.host.repositories.capture(checked.session, signal);
    checked = this.checked(id); signal.throwIfAborted();
    if (JSON.stringify(this.metadata(checked.record, checked.document)) !== JSON.stringify(metadata)) throw new MoguriError("winddown_metadata_changed", "Actual retained accounting changed during finishing preparation. No stale aggregate was sent or repaired.", 409);
    const transfer = this.host.budgets.consumePlan(checked.session, checked.record.step.planId, { stepId, turnId: checked.record.turnId, role: "checkpoint",
      modelId: model.id, providerId: model.providerId, apiModelId: model.apiModelId, authorityDigest: checked.record.authorityDigest,
      inputEstimate: configured.estimatedTokens, maxOutputTokens: checked.record.step.outputBound, repositoryCapture: this.host.repositories.finalize(checked.session, attribution) });
    const next = projectWinddown(checked.record, { ...checked.record, revision: checked.record.revision + 1, updatedAt: new Date().toISOString(), status: "running",
      ...(checked.record.version === 2 ? { transport: this.host.transport(checked.session) } : {}),
      step: { ...checked.record.step, state: "started", stepId, inputDigest: this.store.putBlob(JSON.stringify({ systemPrompt: checked.document.systemPrompt, messages: context })) } });
    this.host.commit([...transfer.events, this.event(next), { event_type: "model.started", profile_id: next.profileId, project_id: next.projectId, session_id: next.sessionId,
      turn_id: next.turnId, step_id: stepId, payload: { modelId: model.id, providerId: model.providerId, apiModelId: model.apiModelId, role: "checkpoint",
        source: model.source ?? "copilot", contextWindow: configured.model.contextWindow, contextEstimate: configured.estimatedTokens } }]);
    return { ...prepared, model: { ...configured.model, maxTokens: transfer.maxTokens }, maxTokens: transfer.maxTokens, phase: "checkpoint",
      context, systemPrompt: checked.document.systemPrompt, steers: [], tools: [], mode: "read-only", folders: { denied: [], readOnly: [] } };
  }
  complete(id: string, stepId: string, message: AssistantMessage, usage: Usage, stopped: boolean): { accepted: true } {
    const record = this.record(id);
    if (record.status !== "running" || record.step.stepId !== stepId || record.step.state !== "started") throw new MoguriError("winddown_result", "That result has no exact original finishing model call.", 409);
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join(""), resultDigest = this.store.putBlob(JSON.stringify({ ...message, errorMessage: message.errorMessage ? "Provider request failed." : undefined, diagnostics: undefined }));
    let diagnostic: string | null = null;
    try {
      if (stopped || message.stopReason !== "stop" || message.content.some((block) => block.type === "toolCall") || !text.isWellFormed() || Buffer.byteLength(text) > 8192 ||
        !reportedModelUsage(usage)) throw new MoguriError("winddown_result", "The finishing model is stopped, incomplete, over-bound or unmetered. Raw output and real/unknown charges remain retained; no Git authority.", 409);
      const entry = this.host.snapshot().budgetEntries.find((entry) => entry.id === stepId);
      if (!entry || modelOutputExceeded(entry, usage)) throw new MoguriError("winddown_result", "Finishing output exceeded/lost its actual reservation. No Git approval or free completion.", 409);
      const value = parse(Type.Object({ summary: Type.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: false }), JSON.parse(text));
      if (!value.summary.trim() || !value.summary.isWellFormed()) throw new MoguriError("winddown_result", "The checkpoint summary is not bounded lossless data.", 409);
    } catch (error) {
      if (!(error instanceof MoguriError) && !(error instanceof SyntaxError)) console.error("Wind-down result validation failed: winddown_result");
      diagnostic = error instanceof MoguriError ? error.message : "The finishing result is not the exact JSON summary contract. Raw output and charges were retained.";
    }
    const uncertain = stopped || !reportedModelUsage(usage) || ["aborted", "pending", "deferred"].includes(message.stopReason);
    const next = projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status: diagnostic ? uncertain ? "partial" : "failed" : "running", diagnostic,
      step: { ...record.step, state: "recorded", resultDigest, outcome: message.stopReason } });
    this.host.commit([{ event_type: "model.completed", profile_id: record.profileId, project_id: record.projectId, session_id: record.sessionId, turn_id: record.turnId,
      step_id: stepId, payload: { contextDigest: resultDigest, usage, message: { id: stepId, turnId: record.turnId, role: "notice",
        text: diagnostic ?? "Budget checkpoint data retained. Original work is interrupted, not complete; source acceptance and Git review remain separate.", timestamp: new Date(message.timestamp).toISOString(), outcome: message.stopReason, toolCalls: [] } } }, this.event(next)]);
    if (!diagnostic) {
      const current = this.record(id);
      if (!successfulRoleEntry(this.host.snapshot().budgetEntries.find((entry) => entry.id === stepId))) diagnostic = "The actual finishing call did not settle within its complete reported output bound. No ready checkpoint or Git authority.";
      this.host.commit([this.event(projectWinddown(current, { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), status: diagnostic ? "failed" : "ready", diagnostic }))]);
    }
    if (diagnostic) throw new MoguriError("winddown_result", diagnostic, 409);
    return { accepted: true };
  }
  derived(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
    return snapshot.winddowns.filter((record) => (record.status === "held" || record.status === "running") && events.some((event) =>
      event.event_type === "turn.finished" && event.turn_id === record.turnId && event.session_id === record.sessionId ||
      event.event_type === "session.deleted" && [record.sessionId, record.ownerSessionId].includes(event.payload.deletedSessionId)))
      .map((record) => this.terminal(record, record.status === "held" ? "unused" : "partial", record.status === "held" ?
        "The actual owner ended without dispatching this finishing envelope. Only canonically undispatched capacity releases; no model call or Git result was invented." :
        "Original finishing call ended or lost control without an acknowledged result. Unknown usage remains held; no model or Git operation was replayed."));
  }
  terminal(record: WinddownRecord, status: "unused" | "partial" | "unavailable", diagnostic: string): EventInput {
    return this.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status, diagnostic,
      step: record.step.state === "started" ? { ...record.step, state: "unconfirmed", diagnostic } : record.step }));
  }
  recover(): EventInput[] {
    return this.host.snapshot().winddowns.filter((record) => record.status === "held" || record.status === "running" || record.status === "committing")
      .flatMap((record) => {
        const diagnostic = "Service restarted. Original wind-down model/Git intent and results were retained; no paid call or branch effect was replayed.";
        const events: EventInput[] = [this.terminal(record, record.status === "held" ? "unused" : "partial", diagnostic)];
        if (record.status === "committing" && record.commit && this.host.snapshot().jobs.some((job) => job.id === record.commit?.jobId && job.status === "running")) events.push({
          event_type: "job.finished", profile_id: record.profileId, project_id: record.projectId, session_id: record.sessionId,
          payload: { jobId: record.commit.jobId, winddownId: record.id, status: "partial", resultDigest: null, error: diagnostic },
        });
        return events;
      });
  }
  lateResult(record: WinddownRecord, resultDigest: string, outcome: string): EventInput[] {
    if (record.version !== 2 || record.status !== "partial" || !record.step.stepId || record.step.state !== "unconfirmed") {
      if (record.step.resultDigest === resultDigest && record.step.outcome === outcome) return [];
      throw new MoguriError("winddown_late_owner", "Only the exact original unconfirmed non-Local finishing step can gain late data. No held role, result replacement or Git work was adopted.", 409);
    }
    return [this.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(),
      step: { ...record.step, state: "recorded", resultDigest, outcome } }))];
  }
  async query(query: WinddownQuery): Promise<WinddownResponse> {
    if (query.type === "winddown.status") {
      const state = this.host.snapshot(), session = state.sessions.find((session) => session.id === query.sessionId);
      if (!session) throw new MoguriError("winddown_scope", "Choose an exact existing session in this immutable profile for finishing readiness.", 404);
      try {
        if (!state.policy.allowedEnvs.includes(session.controls.env)) throw new MoguriError("winddown_env", "Current user-only allowed-env policy blocks this execution boundary. No Local fallback.", 403);
        if (session.controls.env !== "Local") this.host.scopeDigest(session);
        const capability = this.capability(session.controls), policy = state.settings.values.kupo;
        const ids = [...new Set([capability.model.id, ...(session.controls.modelId === "kupo" ? [policy.classifierModelId, ...policy.approvedModelIds] : [session.controls.modelId])].filter((id): id is string => id !== null))];
        const accounting = this.host.budgets.status(session.id, capability.model.id);
        const usdReady = ids.every((id) => this.host.budgets.status(session.id, id).rate !== null) && accounting.totals.unpricedCalls === 0 &&
          (accounting.totals.plannedHolds === 0 || accounting.totals.plannedHeldUsd !== null);
        return { type: query.type, ready: true, modelId: capability.model.id, inputBound: capability.inputBound, outputBound: capability.outputBound, usdReady,
          reason: `Explicit ${session.controls.env} reserved metadata-only finishing model. Actual all-role capacity, captured transport and current caps are rechecked at admission/transfer. Source acceptance and Git confirmation remain separate.` };
      } catch (error) {
        if (!(error instanceof MoguriError)) throw error;
        return { type: query.type, ready: false, modelId: state.settings.values.winddown.modelId, inputBound: null, outputBound: null, usdReady: false, reason: error.message };
      }
    }
    if (query.type === "winddown.commit.preview") return { type: query.type, preview: await this.commits.preview(query) };
    const winddown = this.record(query.winddownId);
    return { type: query.type, winddown, input: this.document(winddown), roleInput: winddown.step.inputDigest ? this.store.blob(winddown.step.inputDigest) : null,
      result: winddown.step.resultDigest ? this.store.blob(winddown.step.resultDigest) : null,
      commitDocument: winddown.commitDocumentDigest ? parse(WinddownCommitDocumentSchema, JSON.parse(this.store.blob(winddown.commitDocumentDigest))) : null };
  }
  async execute(command: WinddownCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const record = this.record(command.winddownId);
    if (command.type === "winddown.commit") return this.commits.execute(command, finish);
    if (command.type === "winddown.stop") {
      try {
        return finish(record.status === "committing" && record.commit && !record.commit.cancelRequested ?
          [this.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), commit: { ...record.commit, cancelRequested: true } }))] : [], { id: record.id });
      } finally {
        if (record.status === "committing" && record.commit) this.host.stopJob(record.commit.jobId);
        else this.host.stop(record.sessionId, record.turnId);
      }
    }
    if (command.type === "winddown.decline" && record.status === "ready" && record.revision === command.expectedRevision) return finish([
      this.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status: "declined", diagnostic: "The actual user declined accepted-work checkpoint publication. No Git effect occurred." })),
    ], { id: record.id, revision: record.revision + 1 });
    throw new MoguriError("winddown_commit_unqualified", "Accepted-work Git publication is not yet qualified in this source checkpoint. Original bytes, index/HEAD and reports were preserved.", 409);
  }
}
