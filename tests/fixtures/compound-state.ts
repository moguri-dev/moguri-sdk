import { projectCompoundWorkflow, type CompoundWorkflow } from "../../packages/protocol/src/compound.ts";

export function compoundRecord(): CompoundWorkflow {
  const now = "2026-07-01T00:00:00.000Z";
  return { version: 1, id: "generated-workflow", profileId: "generated-profile", sessionId: "generated-session", ownerSessionId: "generated-session", ownerTurnId: "generated-workflow",
    projectId: "generated-project", workspaceId: null, folderId: null, env: "Local", draftWorkspaceId: "generated-draft-root", alternateWorkspaceId: "generated-alternate-root",
    commandId: "generated-original-command", commandDigest: "a".repeat(64), inputDigest: "b".repeat(64), authorityDigest: "c".repeat(64), policyDigest: "d".repeat(64),
    revision: 0, createdAt: now, updatedAt: now, stopRequested: false, status: "running", phase: "router", route: null, validations: [], selectedCandidateId: null, diagnostic: null,
    steps: [{ planId: "generated-router-plan", role: "router", modelId: "generated-router", providerId: "generated-provider", apiModelId: "generated-api-router", inputBound: 1024, outputBound: 128,
      state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null }] };
}
export function classifiedCompound() {
  const initial = projectCompoundWorkflow(undefined, compoundRecord());
  const started = projectCompoundWorkflow(initial, { ...initial, revision: 1, steps: [{ ...initial.steps[0]!, state: "started", stepId: "generated-router-step", inputDigest: "e".repeat(64) }] });
  const observed = projectCompoundWorkflow(started, { ...started, revision: 2, steps: [{ ...started.steps[0]!, state: "recorded", resultDigest: "f".repeat(64), outcome: "stop" }] });
  const value: CompoundWorkflow = { ...observed, revision: 3, phase: "draft",
    route: { routeId: "generated-route", pattern: "cascade", draftId: "generated-draft", escalationId: "generated-escalation", confidence: 1, reason: "Generated untrusted classifier advice." },
    steps: [observed.steps[0]!, ...(["draft", "escalation"] as const).map((role) => ({ ...initial.steps[0]!, role, modelId: `generated-${role}`, apiModelId: `generated-api-${role}`, planId: `generated-${role}-plan` }))] };
  return { observed, value };
}
export function waitingCompound(): CompoundWorkflow {
  const classified = classifiedCompound(), routed = projectCompoundWorkflow(classified.observed, classified.value);
  const steps = structuredClone(routed.steps); steps[1] = { ...steps[1]!, state: "started", stepId: "generated-draft-step", inputDigest: "e".repeat(64) };
  const started = projectCompoundWorkflow(routed, { ...routed, revision: 4, steps });
  steps[1] = { ...steps[1]!, state: "recorded", resultDigest: "f".repeat(64), outcome: "stop" };
  const observed = projectCompoundWorkflow(started, { ...started, revision: 5, steps });
  return projectCompoundWorkflow(observed, { ...observed, revision: 6, status: "waiting_validation", validations: [{
    id: "generated-validation", proposalStepId: "generated-draft-step", stageWorkspaceId: "generated-draft-root",
    reviewDigest: "a".repeat(64), documentDigest: "b".repeat(64), status: "waiting", decision: null, candidateId: null, jobId: null, resultDigest: null, dispatched: false, diagnostic: null,
  }] });
}
