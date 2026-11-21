import { defaultKupoAutomaticLimits, MoguriError, type KupoAutomaticLimits, type RoutingPlan, type RoutingResponseReservation } from "../../../packages/protocol/src/index.ts";

type Phase = RoutingResponseReservation["roles"][number]["phase"];
/**
 * Every role a response may still need from `phase`, reserved together before admission. A Council (D56) reviews each
 * draft with every reviewer in plan order; `member` is the next reviewer's index while the council is reviewing.
 */
export function remainingKupoRoles(plan: RoutingPlan, phase: Phase, counts: { escalations?: number; revisions?: number; member?: number },
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
  } else if (plan.pattern === "council") {
    if (!["draft", "critic", "revision"].includes(phase)) throw new MoguriError("routing_role", "The captured Council cannot adopt Cascade roles.", 409);
    const member = phase === "critic" ? counts.member ?? 0 : 0;
    if (!Number.isSafeInteger(member) || member < 0 || member >= plan.councilIds.length) throw new MoguriError("routing_role", "The Council reviewer position is outside its captured plan.", 409);
    if (phase !== "critic") roles.push({ phase, modelId: plan.modelId });
    roles.push(...plan.councilIds.slice(member).map((modelId) => ({ phase: "critic" as const, modelId })));
    for (let count = counts.revisions ?? 0; count < limits.maxRevisions; count++) roles.push(
      { phase: "revision", modelId: plan.modelId }, ...plan.councilIds.map((modelId) => ({ phase: "critic" as const, modelId })));
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
