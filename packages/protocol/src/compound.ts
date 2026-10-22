import { Type, type Static, type TSchema } from "typebox";
import { CandidatePatchSchema, CandidateRootSchema, type CandidateDocument, type CandidateRoleProposalRead } from "./candidates.ts";
import { CandidateGenerationDocumentSchema, CandidateGenerationInputSchema } from "./candidate-generations.ts";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { RoleSequenceStepSchema, validateRoleLedger } from "./role-sequences.ts";
import type { BudgetPlan } from "./budget-plans.ts";
import type { BudgetEntry } from "./budgets.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 256 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const RoutingPoolSchema = object({
  enabled: Type.Boolean(), classifierModelId: Type.Union([id, Type.Null()]),
  approvedModelIds: Type.Array(id, { maxItems: 8, uniqueItems: true }),
  allowHosted: Type.Boolean(), minimumConfidence: Type.Number({ minimum: 0, maximum: 1 }),
});
export type RoutingPool = Static<typeof RoutingPoolSchema>;
export const CompoundRouteSchema = Type.Union([
  object({ id, pattern: Type.Literal("cascade"), draftId: id, escalationId: id }),
  object({ id, pattern: Type.Literal("critique"), draftId: id, criticId: id, lineageReviewId: Type.Union([id, Type.Null()]) }),
]);
export type CompoundRoute = Static<typeof CompoundRouteSchema>;
const plan = { routeId: id, confidence: Type.Number({ minimum: 0, maximum: 1 }), reason: Type.String({ minLength: 1, maxLength: 1200 }) };
export const CompoundRouterPlanSchema = Type.Union([
  object({ ...plan, pattern: Type.Literal("cascade"), draftId: id, escalationId: id }),
  object({ ...plan, pattern: Type.Literal("critique"), draftId: id, criticId: id }),
]);
export type CompoundRouterPlan = Static<typeof CompoundRouterPlanSchema>;
export const CompoundLineageReviewSchema = object({
  version: Type.Literal(1), id, actor: Type.Literal("user"), draftBindingDigest: hash, criticBindingDigest: hash,
  draftLineage: id, criticLineage: id,
  sourceKind: Type.Union([Type.Literal("reviewed-model-card"), Type.Literal("reviewed-training-report"), Type.Literal("reviewed-independent-audit")]),
  sourceUrl: Type.String({ minLength: 1, maxLength: 4096 }), sourceText: Type.String({ minLength: 1, maxLength: 16 * 1024 }), sourceDigest: hash,
  reviewedAt: Type.String({ minLength: 20, maxLength: 32 }), validUntil: Type.String({ minLength: 20, maxLength: 32 }),
  limitations: Type.String({ minLength: 1, maxLength: 1200 }),
});
export type CompoundLineageReview = Static<typeof CompoundLineageReviewSchema>;
export const CompoundLimitsSchema = object({
  routerTokens: Type.Integer({ minimum: 1, maximum: 2048 }), proposalTokens: Type.Integer({ minimum: 1, maximum: 8192 }),
  criticTokens: Type.Integer({ minimum: 1, maximum: 4096 }), timeoutMs: Type.Integer({ minimum: 1000, maximum: 300_000 }),
});
export const CompoundSettingsSchema = object({
  ...RoutingPoolSchema.properties, workflow: Type.Literal("compound"),
  routes: Type.Array(CompoundRouteSchema, { minItems: 1, maxItems: 4 }),
  lineageReviews: Type.Array(CompoundLineageReviewSchema, { maxItems: 16 }), limits: CompoundLimitsSchema,
});
export type CompoundSettings = Static<typeof CompoundSettingsSchema>;
export const CompoundProposalSchema = object({
  plan: Type.String({ minLength: 1, maxLength: 8192 }), architecture: Type.String({ minLength: 1, maxLength: 8192 }), patch: CandidatePatchSchema,
});
export type CompoundProposal = Static<typeof CompoundProposalSchema>;
const verdict = Type.Union([Type.Literal("pass"), Type.Literal("revise"), Type.Literal("reject")]);
const critiquePart = object({
  verdict, reason: Type.String({ minLength: 1, maxLength: 1200 }), issues: Type.Array(Type.String({ minLength: 1, maxLength: 1200 }), { maxItems: 8 }),
});
export const CompoundCritiqueSchema = object({ verdict, plan: critiquePart, architecture: critiquePart, implementation: critiquePart });
export type CompoundCritique = Static<typeof CompoundCritiqueSchema>;
const maybeId = Type.Union([id, Type.Null()]), maybeHash = Type.Union([hash, Type.Null()]);
const time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
export const CompoundValidationSchema = object({
  id, proposalStepId: id, stageWorkspaceId: id, reviewDigest: hash, documentDigest: hash,
  status: Type.Union([Type.Literal("waiting"), Type.Literal("staging"), Type.Literal("ready"), Type.Literal("running"), Type.Literal("passed"),
    Type.Literal("failed"), Type.Literal("denied"), Type.Literal("stopped"), Type.Literal("partial")]),
  decision: Type.Union([object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, at: time }), Type.Null()]),
  candidateId: maybeId, jobId: maybeId, resultDigest: maybeHash, dispatched: Type.Boolean(), diagnostic,
});
export type CompoundValidation = Static<typeof CompoundValidationSchema>;
export const CompoundWorkflowSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, ownerSessionId: id, ownerTurnId: maybeId,
  projectId: id, workspaceId: maybeId, folderId: maybeId, env: Type.Literal("Local"), draftWorkspaceId: id, alternateWorkspaceId: id,
  commandId: id, commandDigest: hash, inputDigest: hash, authorityDigest: hash, policyDigest: hash,
  revision: Type.Integer({ minimum: 0 }), createdAt: time, updatedAt: time, stopRequested: Type.Boolean(),
  status: Type.Union([Type.Literal("running"), Type.Literal("waiting_validation"), Type.Literal("validating"), Type.Literal("proposed"),
    Type.Literal("rejected"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]),
  phase: Type.Union([Type.Literal("router"), Type.Literal("draft"), Type.Literal("critic"), Type.Literal("revision"), Type.Literal("escalation"), Type.Literal("settled")]),
  route: Type.Union([CompoundRouterPlanSchema, Type.Null()]), steps: Type.Array(RoleSequenceStepSchema, { minItems: 1, maxItems: 4 }),
  validations: Type.Array(CompoundValidationSchema, { maxItems: 2 }), selectedCandidateId: maybeId, diagnostic,
});
export type CompoundWorkflow = Static<typeof CompoundWorkflowSchema>;
export const activeCompound = (record: CompoundWorkflow) => ["running", "waiting_validation", "validating"].includes(record.status);
function corrupt(message: string): never {
  throw new MoguriError("compound_corrupt", `${message} State was preserved; no model, test, source acceptance or replay was authorized.`, 409);
}
export function projectCompoundWorkflow(previous: CompoundWorkflow | undefined, value: unknown): CompoundWorkflow {
  if (!Value.Check(CompoundWorkflowSchema, value)) corrupt("Compound workflow has an unsupported shape/version.");
  const next = value, router = next.steps[0]!;
  if (![next.createdAt, next.updatedAt].every((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
    next.draftWorkspaceId === next.alternateWorkspaceId || [next.draftWorkspaceId, next.alternateWorkspaceId].includes(next.workspaceId ?? "") ||
    router.role !== "router" || new Set(next.steps.map((step) => step.planId)).size !== next.steps.length ||
    next.steps.filter((step) => step.state === "started").length > 1) corrupt("Compound ownership, roots, planned roles or timestamps disagree.");
  if (next.route && (router.state !== "recorded" || !router.resultDigest || router.outcome !== "stop") ||
    !next.route && (next.steps.length !== 1 || activeCompound(next) && next.phase !== "router")) corrupt("A concrete route needs its actual retained classifier result.");
  if (next.route) {
    const route = next.route, definitions = route.pattern === "cascade" ? [{ role: "draft", modelId: route.draftId }, { role: "escalation", modelId: route.escalationId }] :
      [{ role: "draft", modelId: route.draftId }, { role: "critic", modelId: route.criticId }, { role: "revision", modelId: route.draftId }];
    if (next.steps.length !== definitions.length + 1 || definitions.some((definition, index) =>
      next.steps[index + 1]?.role !== definition.role || next.steps[index + 1]?.modelId !== definition.modelId)) corrupt("Retained concrete roles disagree with the actual classifier-selected route.");
  }
  if (next.status === "proposed" && (!next.selectedCandidateId || !next.validations.some((validation) => validation.candidateId === next.selectedCandidateId && validation.status === "passed") ||
    next.stopRequested || next.diagnostic !== null) || next.status !== "proposed" && !(next.status === "running" && next.phase === "settled") && next.selectedCandidateId !== null ||
    !activeCompound(next) && next.phase !== "settled" || ["partial", "failed", "stopped", "rejected"].includes(next.status) && !next.diagnostic) corrupt("Compound outcome does not match real validation, stop or retained diagnostic.");
  for (const step of next.steps) {
    if (!step.providerId || !Number.isSafeInteger(step.inputBound + step.outputBound) ||
      ["pending", "skipped"].includes(step.state) && [step.stepId, step.inputDigest, step.resultDigest, step.outcome].some((value) => value !== null) ||
      ["started", "recorded", "unconfirmed"].includes(step.state) && (!step.stepId || !step.inputDigest) ||
      step.state === "recorded" && (!step.resultDigest || !step.outcome)) corrupt("A role observation lost its actual original model, input or result.");
  }
  if (new Set(next.validations.map((validation) => validation.id)).size !== next.validations.length ||
    new Set(next.validations.map((validation) => validation.proposalStepId)).size !== next.validations.length ||
    next.status === "waiting_validation" && next.validations.at(-1)?.status !== "waiting" ||
    next.status === "validating" && !["staging", "ready", "running"].includes(next.validations.at(-1)?.status ?? "")) corrupt("Validation review or execution state has no exact current original operation.");
  for (const validation of next.validations) {
    const step = next.steps.find((step) => step.stepId === validation.proposalStepId);
    if (!step || step.state !== "recorded" || step.outcome !== "stop" || !["draft", "revision", "escalation"].includes(step.role) ||
      validation.stageWorkspaceId !== (step.role === "draft" ? next.draftWorkspaceId : next.alternateWorkspaceId) ||
      validation.status === "waiting" && [validation.decision, validation.candidateId, validation.jobId, validation.resultDigest, validation.diagnostic].some((value) => value !== null) ||
      ["staging", "ready", "running", "passed", "failed", "denied"].includes(validation.status) && !validation.decision ||
      ["staging", "ready", "running", "passed", "failed"].includes(validation.status) && !validation.candidateId ||
      ["ready", "running", "passed", "failed"].includes(validation.status) && !validation.jobId ||
      ["passed", "failed"].includes(validation.status) && !validation.resultDigest ||
      ["running", "passed", "failed"].includes(validation.status) && !validation.dispatched ||
      ["waiting", "staging", "ready", "denied"].includes(validation.status) && validation.dispatched ||
      validation.status === "denied" && (validation.candidateId !== null || validation.jobId !== null || validation.resultDigest !== null || !validation.diagnostic)) corrupt("Validation result, actual-user decision or owned candidate root contradicts its original proposal.");
  }
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.phase !== "router" || next.createdAt !== next.updatedAt || next.stopRequested ||
      next.route || next.validations.length || next.diagnostic || router.state !== "pending") corrupt("Compound work must begin with its exact undispatched router intent.");
  } else {
    const immutable = ["version", "id", "profileId", "sessionId", "ownerSessionId", "ownerTurnId", "projectId", "workspaceId", "folderId", "env", "draftWorkspaceId", "alternateWorkspaceId",
      "commandId", "commandDigest", "inputDigest", "authorityDigest", "policyDigest", "createdAt"] as const;
    if (!activeCompound(previous) || next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      previous.stopRequested && !next.stopRequested || previous.route && JSON.stringify(previous.route) !== JSON.stringify(next.route) ||
      next.steps.length < previous.steps.length || next.validations.length < previous.validations.length ||
      JSON.stringify(previous) === JSON.stringify({ ...next, revision: previous.revision, updatedAt: previous.updatedAt })) corrupt("Original ownership, route or terminal work changed/replayed.");
    for (const [index, old] of previous.steps.entries()) {
      const step = next.steps[index]!;
      if ((["planId", "role", "modelId", "providerId", "apiModelId", "inputBound", "outputBound"] as const).some((key) => old[key] !== step[key]) ||
        (["stepId", "inputDigest", "resultDigest", "outcome"] as const).some((key) => old[key] !== null && old[key] !== step[key]) ||
        JSON.stringify(old) !== JSON.stringify(step) && !(old.state === "pending" && ["started", "skipped"].includes(step.state) ||
          old.state === "started" && ["recorded", "unconfirmed"].includes(step.state))) corrupt("An admitted role binding, observation or no-replay lifecycle changed.");
    }
    if (next.steps.length > previous.steps.length && (previous.route !== null || next.route === null || next.steps.slice(previous.steps.length).some((step) => step.state !== "pending"))) corrupt("Only the original classifier result may append its exact undispatched route.");
    const validationTransitions: Readonly<Record<CompoundValidation["status"], readonly CompoundValidation["status"][]>> = {
      waiting: ["staging", "denied", "partial"], staging: ["ready", "partial"], ready: ["running", "partial"],
      running: ["passed", "failed", "partial"], passed: [], failed: [], denied: [], partial: [], stopped: [],
    };
    for (const [index, old] of previous.validations.entries()) {
      const validation = next.validations[index]!;
      if ((["id", "proposalStepId", "stageWorkspaceId", "reviewDigest", "documentDigest"] as const).some((key) => old[key] !== validation[key]) ||
        (["candidateId", "jobId", "resultDigest"] as const).some((key) => old[key] !== null && old[key] !== validation[key]) ||
        old.decision && JSON.stringify(old.decision) !== JSON.stringify(validation.decision) ||
        old.dispatched && !validation.dispatched || !old.dispatched && validation.dispatched && !(old.status === "ready" && validation.status === "running") ||
        !old.decision && validation.decision && !(old.status === "waiting" && ["staging", "denied"].includes(validation.status)) ||
        JSON.stringify(old) !== JSON.stringify(validation) && !validationTransitions[old.status].includes(validation.status)) corrupt("Original validation bytes, actual-user decision, results or no-replay lifecycle changed.");
    }
    if (next.validations.slice(previous.validations.length).some((validation) => validation.status !== "waiting" || validation.decision !== null)) corrupt("A new test operation needs a separate fresh undecided review, not inherited permission.");
  }
  return structuredClone(next);
}
export const COMPOUND_RESULT_BYTES = 8192;
export function validateCompoundLedger(records: CompoundWorkflow[], plans: BudgetPlan[], entries: BudgetEntry[]): void {
  validateRoleLedger(records.map((record) => ({ ...record, active: activeCompound(record), complete: record.status === "proposed" || record.status === "rejected" })), plans, entries, corrupt);
}
export const COMPOUND_VALIDATION_CONTEXT_BYTES = 16 * 1024;
export const CompoundInputSchema = object({
  sessionId: id, draftWorkspaceId: id, alternateWorkspaceId: id, input: CandidateGenerationInputSchema,
  requestPlan: Type.Union([Type.String({ maxLength: 8192 }), Type.Null()]), requestArchitecture: Type.Union([Type.String({ maxLength: 8192 }), Type.Null()]),
  validationScriptId: id, validationTimeoutMs: Type.Integer({ minimum: 100, maximum: 120_000 }),
});
export type CompoundInput = Static<typeof CompoundInputSchema>;
export const CompoundTaskSchema = object({
  task: CandidateGenerationInputSchema.properties.task, files: CandidateGenerationDocumentSchema.properties.files,
  requestPlan: CompoundInputSchema.properties.requestPlan, requestArchitecture: CompoundInputSchema.properties.requestArchitecture,
});
export type CompoundTask = Static<typeof CompoundTaskSchema>;
const stage = object({ root: CandidateRootSchema, authorityDigest: hash });
export const CompoundDocumentSchema = object({
  format: Type.Literal("moguri-compound-workflow"), version: Type.Literal(1),
  sessionId: id, source: CandidateRootSchema, draft: stage, alternate: stage, authorityDigest: hash,
  task: CompoundTaskSchema, policy: CompoundSettingsSchema, policyJson: Type.String({ minLength: 1, maxLength: 128 * 1024 }), policyDigest: hash,
  validationScript: object({ id, name: Type.String({ minLength: 1, maxLength: 80 }), command: Type.String({ minLength: 1, maxLength: 16384 }), configurationRevision: Type.Integer({ minimum: 0 }) }),
  validationTimeoutMs: CompoundInputSchema.properties.validationTimeoutMs,
  resultBytes: Type.Literal(COMPOUND_RESULT_BYTES), validationContextBytes: Type.Literal(COMPOUND_VALIDATION_CONTEXT_BYTES),
  roles: Type.Array(object({
    role: RoleSequenceStepSchema.properties.role, modelId: id, providerId: id, apiModelId: id,
    modelJson: Type.String({ minLength: 1, maxLength: 16 * 1024 }), systemPrompt: Type.String({ minLength: 1, maxLength: 96 * 1024 }),
    inputBound: Type.Integer({ minimum: 0 }), outputBound: Type.Integer({ minimum: 1, maximum: 8192 }),
  }), { minItems: 3, maxItems: 32 }),
  routes: Type.Array(CompoundRouteSchema, { minItems: 1, maxItems: 4 }),
});
export type CompoundDocument = Static<typeof CompoundDocumentSchema>;
export const CompoundValidationDocumentSchema = object({
  format: Type.Literal("moguri-compound-validation"), version: Type.Literal(1),
  workflowId: id, proposalStepId: id, proposalResultDigest: hash, proposalInputDigest: hash, workflowInputDigest: hash,
  sessionId: id, role: Type.Union([Type.Literal("draft"), Type.Literal("revision"), Type.Literal("escalation")]),
  source: CandidateRootSchema, stage: CandidateRootSchema, authorityDigest: hash, candidateReviewDigest: hash,
  proposal: CompoundProposalSchema, command: Type.String({ minLength: 1, maxLength: 16384 }), scriptId: id, scriptDigest: hash,
  timeoutMs: CompoundInputSchema.properties.validationTimeoutMs, policyDigest: hash,
});
export type CompoundValidationDocument = Static<typeof CompoundValidationDocumentSchema>;
export const CompoundValidationResultSchema = object({
  version: Type.Literal(1), validationId: id, candidateId: id, stage: CandidateRootSchema, commandDigest: hash,
  text: Type.String({ maxLength: 128 * 1024 + 4096 }), isError: Type.Boolean(),
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("partial")]),
  exitCode: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]), signal: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  candidateUnchanged: Type.Boolean(), diagnostic,
});
export type CompoundValidationResult = Static<typeof CompoundValidationResultSchema>;
export const CompoundCommandSchema = Type.Union([
  object({ type: Type.Literal("compound.start"), input: CompoundInputSchema, expectedDigest: hash, confirmCost: Type.Literal(true) }),
  object({ type: Type.Literal("compound.review"), workflowId: id, validationId: id, expectedRevision: Type.Integer({ minimum: 0 }), expectedDigest: hash, allow: Type.Boolean() }),
  object({ type: Type.Literal("compound.stop"), workflowId: id }),
]);
export type CompoundCommand = Static<typeof CompoundCommandSchema>;
export const CompoundQuerySchema = Type.Union([
  object({ type: Type.Literal("compound.preview"), input: CompoundInputSchema }),
  object({ type: Type.Literal("compound.read"), workflowId: id }),
]);
export type CompoundQuery = Static<typeof CompoundQuerySchema>;
export const isCompoundCommand = (value: unknown): value is CompoundCommand => Value.Check(CompoundCommandSchema, value);
export const isCompoundQuery = (value: unknown): value is CompoundQuery => Value.Check(CompoundQuerySchema, value);
export interface CompoundCandidateProposal extends Omit<CandidateRoleProposalRead, "type" | "document"> {
  document: CandidateDocument & { compoundOrigin: import("./candidates.ts").CandidateCompoundOrigin };
}
export type CompoundResponse =
  | { type: "compound.preview"; preview: { document: CompoundDocument; digest: string; warning: string } }
  | { type: "compound.read"; workflow: CompoundWorkflow; input: CompoundDocument;
      roles: Array<{ step: Static<typeof RoleSequenceStepSchema>; input: string | null; result: string | null }>;
      pendingValidation: { validationId: string; digest: string; document: CompoundValidationDocument } | null;
      validations: Array<{ validation: CompoundValidation; document: CompoundValidationDocument; result: CompoundValidationResult | null }> };
export const COMPOUND_EVIDENCE_WARNING = "Lineage eligibility is an actual-user-reviewed source claim, not proof about unobservable training or model quality. Provider declarations, aliases and matching output contracts are not that review. Passing project tests covers only those commands and exact bytes; critics do not grant permissions or accept source changes.";
