import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { BudgetEntry } from "./budgets.ts";
import type { BudgetPlan } from "./budget-plans.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const maybeId = Type.Union([id, Type.Null()]);
const maybeHash = Type.Union([hash, Type.Null()]);
const time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const RoleSequenceStepSchema = object({
  planId: id, role: Type.Union([Type.Literal("router"), Type.Literal("draft"), Type.Literal("critic"), Type.Literal("revision"), Type.Literal("escalation"), Type.Literal("checkpoint")]),
  modelId: id, providerId: maybeId, apiModelId: id,
  inputBound: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), outputBound: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  state: Type.Union([Type.Literal("pending"), Type.Literal("started"), Type.Literal("recorded"), Type.Literal("skipped"), Type.Literal("unconfirmed")]),
  stepId: maybeId, inputDigest: maybeHash, resultDigest: maybeHash,
  outcome: Type.Union([Type.Literal("stop"), Type.Literal("length"), Type.Literal("toolUse"), Type.Literal("error"), Type.Literal("aborted"), Type.Literal("pending"), Type.Literal("deferred"), Type.Literal("unknown"), Type.Null()]),
  diagnostic,
});
export type RoleSequenceStep = Static<typeof RoleSequenceStepSchema>;
export const RoleSequenceRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, ownerSessionId: id, ownerTurnId: maybeId,
  projectId: maybeId, workspaceId: maybeId, folderId: maybeId,
  env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]),
  commandId: id, commandDigest: hash, inputDigest: hash, authorityDigest: hash, policyDigest: hash,
  revision: Type.Integer({ minimum: 0 }), createdAt: time, updatedAt: time, stopRequested: Type.Boolean(),
  status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]),
  steps: Type.Array(RoleSequenceStepSchema, { minItems: 1, maxItems: 32 }), diagnostic,
});
export type RoleSequenceRecord = Static<typeof RoleSequenceRecordSchema>;
function corrupt(message: string): never {
  throw new MoguriError("role_sequence_corrupt", `${message} State was preserved; no role, acceptance or paid continuation was adopted.`, 409);
}
const definition = ["planId", "role", "modelId", "providerId", "apiModelId", "inputBound", "outputBound"] as const;
const observed = ["stepId", "inputDigest", "resultDigest", "outcome"] as const;
export function projectRoleSequence(previous: RoleSequenceRecord | undefined, value: unknown): RoleSequenceRecord {
  if (!Value.Check(RoleSequenceRecordSchema, value)) corrupt("Role sequence has an unsupported shape/version.");
  const next = value;
  if (!validTime(next.createdAt) || !validTime(next.updatedAt) || next.projectId === null && next.workspaceId !== null ||
    next.ownerSessionId === next.sessionId && next.ownerTurnId !== next.id ||
    new Set(next.steps.map((step) => step.planId)).size !== next.steps.length ||
    new Set(next.steps.filter((step) => step.stepId !== null).map((step) => step.stepId)).size !== next.steps.filter((step) => step.stepId !== null).length) corrupt("Role ownership, original planned IDs or observations disagree.");
  let blocked = false, active = 0, recorded = 0;
  for (const step of next.steps) {
    if (!Number.isSafeInteger(step.inputBound + step.outputBound)) corrupt("A complete role bound exceeds safe precision.");
    if (step.state === "pending" || step.state === "skipped") {
      if (observed.some((key) => step[key] !== null) || step.state === "pending" && step.diagnostic !== null ||
        step.state === "skipped" && step.diagnostic === null) corrupt("An undispatched role has contradictory observed-call evidence.");
    } else if (step.stepId === null || step.inputDigest === null) corrupt("An observed role lost its exact original model step/input.");
    if (step.state === "started" && (step.resultDigest !== null || step.outcome !== null || step.diagnostic !== null) ||
      step.state === "unconfirmed" && (step.resultDigest !== null || step.outcome !== null || step.diagnostic === null) ||
      step.state === "recorded" && (step.resultDigest === null || step.outcome === null)) corrupt("Role result/cleanup state contradicts its actual observations.");
    if (step.state === "started" || step.state === "unconfirmed" || step.state === "recorded") {
      if (blocked) corrupt("A later role was admitted before an exact successful earlier result.");
      if (step.state === "recorded") recorded++; else active++;
    }
    if (step.state === "pending" || step.state === "started" || step.state === "unconfirmed" || step.state === "recorded" && step.outcome !== "stop") blocked = true;
  }
  if (active > 1 || next.status === "running" && next.steps.some((step) => step.state === "unconfirmed") ||
    next.status !== "running" && next.steps.some((step) => step.state === "started") ||
    next.status === "completed" && (!recorded || blocked || next.stopRequested || next.diagnostic !== null) ||
    ["stopped", "failed", "partial"].includes(next.status) && next.diagnostic === null) corrupt("Role sequence terminal state does not match its actual calls/stop/diagnostic.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.createdAt !== next.updatedAt || next.stopRequested || next.diagnostic ||
      next.steps.some((step) => step.state !== "pending")) corrupt("A role sequence must begin with exact undispatched intent.");
  } else {
    const immutable = ["version", "id", "profileId", "sessionId", "ownerSessionId", "ownerTurnId", "projectId", "workspaceId", "folderId", "env",
      "commandId", "commandDigest", "inputDigest", "authorityDigest", "policyDigest", "createdAt"] as const;
    if (next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      next.steps.length !== previous.steps.length || previous.stopRequested && !next.stopRequested) corrupt("Original role sequence ownership/input/intent changed or replayed.");
    if (previous.status !== "running" && (next.status !== previous.status || next.stopRequested !== previous.stopRequested || next.diagnostic !== previous.diagnostic)) corrupt("A terminal role sequence cannot regain authority or rewrite its outcome.");
    let lateResult = false, changedStep = false;
    for (const [index, step] of next.steps.entries()) {
      const old = previous.steps[index]!;
      if (definition.some((key) => old[key] !== step[key]) || observed.some((key) => old[key] !== null && old[key] !== step[key])) corrupt("Original role binding or observed model input/result was replaced.");
      const same = JSON.stringify(old) === JSON.stringify(step);
      changedStep ||= !same;
      const transition = old.state === "pending" && ["started", "skipped"].includes(step.state) ||
        old.state === "started" && ["recorded", "unconfirmed"].includes(step.state) ||
        old.state === "unconfirmed" && step.state === "recorded";
      if (old.state === "pending" && step.state === "started" && (previous.stopRequested || next.stopRequested)) corrupt("A requested stop cannot authorize a new model role.");
      if (!same && (!transition || previous.status !== "running" && !(old.state === "unconfirmed" && step.state === "recorded"))) corrupt("An observed/terminal role cannot replay or start new work.");
      lateResult ||= !same && old.state === "unconfirmed" && step.state === "recorded";
    }
    if (previous.status !== "running" && !lateResult) corrupt("A terminal role revision must retain an actual late result, not replay its state.");
    if (previous.status === "running" && !changedStep && next.status === previous.status && next.stopRequested === previous.stopRequested && next.diagnostic === previous.diagnostic) corrupt("A role revision needs an actual observation, stop or outcome, not a replay.");
  }
  return structuredClone(next);
}

export function validateRoleSequenceLedger(records: RoleSequenceRecord[], plans: BudgetPlan[], entries: BudgetEntry[]): void {
  const usedPlans = new Set<string>(), usedSteps = new Set<string>(), commands = new Set<string>();
  const planned = new Map(plans.map((plan) => [plan.id, plan])), started = new Map(entries.map((entry) => [entry.id, entry]));
  if (planned.size !== plans.length || started.size !== entries.length) corrupt("Role accounting contains duplicate original plan/step identities.");
  for (const record of records) {
    if (commands.has(record.commandId)) corrupt("One original command cannot own multiple independent role sequences.");
    commands.add(record.commandId);
    for (const [index, step] of record.steps.entries()) {
      const plan = planned.get(step.planId);
      if (usedPlans.has(step.planId) || !plan || plan.profileId !== record.profileId || plan.sessionId !== record.sessionId || plan.ownerSessionId !== record.ownerSessionId ||
        plan.turnId !== record.id || plan.ownerTurnId !== record.ownerTurnId || plan.projectId !== record.projectId || plan.folderId !== record.folderId || plan.env !== record.env ||
        plan.authorityDigest !== record.authorityDigest || definition.filter((key) => key !== "planId" && key !== "inputBound" && key !== "outputBound").some((key) => plan[key] !== step[key]) ||
        plan.inputBound !== step.inputBound || plan.outputBound !== step.outputBound) corrupt("An original role lost its exact retained planned capacity/model/owner.");
      usedPlans.add(step.planId);
      if (step.stepId === null) {
        if (plan.status === "consumed" || record.status === "running" && step.state === "pending" && plan.status !== "held") corrupt("An undispatched role cannot borrow consumed/released capacity.");
        continue;
      }
      const entry = started.get(step.stepId);
      if (usedSteps.has(step.stepId) || !entry || entry.planId !== plan.id || plan.status !== "consumed" || plan.consumedStepId !== entry.id ||
        entry.sessionId !== record.sessionId || entry.ownerSessionId !== record.ownerSessionId || entry.turnId !== record.id || entry.env !== record.env ||
        entry.modelId !== step.modelId || entry.providerId !== step.providerId || entry.apiModelId !== step.apiModelId || entry.role !== step.role ||
        entry.inputEstimate === null || entry.inputEstimate > step.inputBound || entry.outputLimit !== step.outputBound) corrupt("An observed role has no matching actual started ledger entry.");
      usedSteps.add(step.stepId);
      const success = entry.status === "settled" && entry.reportedTokens !== null && Number.isSafeInteger(entry.reportedTokens) && entry.reportedTokens >= 0 &&
        typeof entry.outputTokens === "number" && Number.isSafeInteger(entry.outputTokens) && entry.outputTokens >= 0 &&
        entry.outputTokens <= entry.reportedTokens && entry.outputTokens <= entry.outputLimit && entry.outcome === "stop" && !entry.outputLimitViolation;
      // Raw observations can precede derived settlement, but never authorize the next role by themselves.
      if (step.state === "recorded" && entry.status === "settled" && step.outcome !== entry.outcome || record.steps.slice(index + 1).some((later) => later.stepId !== null) && !success ||
        record.status === "completed" && !success) corrupt("Unknown/failed model accounting cannot authorize a later role or successful sequence.");
    }
  }
}
export function interruptedRoleSequence(record: RoleSequenceRecord, diagnostic: string): RoleSequenceRecord {
  return projectRoleSequence(record, { ...record, revision: record.revision + 1, status: "partial", updatedAt: new Date().toISOString(), diagnostic,
    steps: record.steps.map((step) => step.state === "started" ? { ...step, state: "unconfirmed", diagnostic } : step) });
}
export const RoleSequenceQuerySchema = object({
  type: Type.Literal("role.sequence.read"), sequenceId: id, index: Type.Optional(Type.Integer({ minimum: 0, maximum: 31 })),
});
export type RoleSequenceQuery = Static<typeof RoleSequenceQuerySchema>;
export const isRoleSequenceQuery = (value: unknown): value is RoleSequenceQuery => Value.Check(RoleSequenceQuerySchema, value);
export interface RoleSequenceResponse {
  type: "role.sequence.read"; sequence: RoleSequenceRecord; text: string;
  step: { index: number; input: string | null; result: string | null } | null;
}
