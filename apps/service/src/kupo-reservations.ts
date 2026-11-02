import { defaultKupoAutomaticLimits, MoguriError, type KupoAutomaticLimits, type RoutingPlan, type RoutingResponseReservation } from "../../../packages/protocol/src/index.ts";

type Phase = RoutingResponseReservation["roles"][number]["phase"];
export function remainingKupoRoles(plan: RoutingPlan, phase: Phase, counts: { escalations?: number; revisions?: number },
  limits: KupoAutomaticLimits = defaultKupoAutomaticLimits()): Array<{ phase: Phase; modelId: string }> {
  if (plan.pattern === "single") {
    if (phase !== "solver") throw new MoguriError("routing_role", "A Single plan cannot adopt compound roles or a new model.", 409);
    return [{ phase, modelId: plan.modelId }];
  }
  const roles: Array<{ phase: Phase; modelId: string }> = [];
  if (plan.pattern === "cascade") {
    if (!["draft", "gate", "escalation"].includes(phase)) throw new MoguriError("routing_role", "The captured Cascade cannot adopt Critique roles.", 409);
    if (phase === "draft") roles.push({ phase: "draft", modelId: plan.modelId });
    if (phase === "escalation") roles.push({ phase: "escalation", modelId: plan.escalationId });
    roles.push({ phase: "gate", modelId: plan.escalationId });
    for (let count = counts.escalations ?? 0; count < limits.maxEscalations; count++) roles.push(
      { phase: "escalation", modelId: plan.escalationId }, { phase: "gate", modelId: plan.escalationId });
  } else {
    if (!["draft", "critic", "revision"].includes(phase)) throw new MoguriError("routing_role", "The captured Critique cannot adopt Cascade roles.", 409);
    if (phase === "draft") roles.push({ phase: "draft", modelId: plan.modelId });
    if (phase === "revision") roles.push({ phase: "revision", modelId: plan.modelId });
    roles.push({ phase: "critic", modelId: plan.criticId });
    for (let count = counts.revisions ?? 0; count < limits.maxRevisions; count++) roles.push(
      { phase: "revision", modelId: plan.modelId }, { phase: "critic", modelId: plan.criticId });
  }
  return roles;
}
