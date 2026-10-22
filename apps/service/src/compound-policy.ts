import { MoguriError, parse, type Controls, type ModelInfo } from "../../../packages/protocol/src/index.ts";
import { Value } from "typebox/value";
import { COMPOUND_EVIDENCE_WARNING, compoundModelBindingText, CompoundRouterPlanSchema, CompoundSettingsSchema, type CompoundLineageReview, type CompoundRoute } from "../../../packages/protocol/src/compound.ts";
import { digest } from "./store.ts";
import { routingModelReady, routingWorkingWindow, type BoundedRoutingModel } from "./routing.ts";

export function compoundModelBinding(model: ModelInfo): string {
  return digest(compoundModelBindingText(model));
}
function currentLineageSource(review: CompoundLineageReview): boolean {
  const reviewed = Date.parse(review.reviewedAt), until = Date.parse(review.validUntil), now = Date.now();
  if (!Number.isFinite(reviewed) || !Number.isFinite(until) || new Date(reviewed).toISOString() !== review.reviewedAt ||
    new Date(until).toISOString() !== review.validUntil || reviewed > now || until <= now || until <= reviewed) return false;
  let source: URL;
  try { source = new URL(review.sourceUrl); }
  catch (error) { if (error instanceof TypeError) return false; throw error; }
  return source.protocol === "https:" && !source.username && !source.password;
}
export function compoundPool(value: unknown, models: ModelInfo[], env: Controls["env"], estimatedTokens = 0) {
  const policy = parse(CompoundSettingsSchema, value);
  if (env !== "Local") throw new MoguriError("compound_env", "Public compound staging/validation needs exact owned Local candidate worktrees. Unqualified Remote/native combinations never use a Local fallback.", 409);
  if (!policy.enabled) throw new MoguriError("compound_disabled", "Explicitly configure the public compound policy before model admission. No fixed model or endpoint was changed.", 409);
  if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) throw new MoguriError("compound_context", "Complete compound input estimates must be known nonnegative token counts. No model was admitted.", 409);
  const fits = (model: ModelInfo | undefined, output: number): model is BoundedRoutingModel => Boolean(model && routingModelReady(model, policy, env) &&
    model.maxTokens >= output && routingWorkingWindow(model) >= estimatedTokens + output + 4096);
  const classifier = models.find((model) => model.id === policy.classifierModelId);
  if (!fits(classifier, policy.limits.routerTokens) || !classifier.providerId || !classifier.apiModelId) throw new MoguriError("compound_classifier", "The exact classifier does not fit this env/privacy/context/output binding. No route or provider was substituted.", 409);
  const candidates = models.filter((model): model is BoundedRoutingModel => policy.approvedModelIds.includes(model.id) && routingModelReady(model, policy, env));
  if (new Set(policy.routes.map((route) => route.id)).size !== policy.routes.length) throw new MoguriError("compound_route", "Approved compound routes require distinct immutable IDs.", 409);
  const routes: CompoundRoute[] = [], diagnostics: Array<{ routeId: string; code: string; message: string }> = [];
  for (const route of policy.routes) {
    const draft = candidates.find((model) => model.id === route.draftId), other = candidates.find((model) => model.id === (route.pattern === "cascade" ? route.escalationId : route.criticId));
    if (!fits(draft, policy.limits.proposalTokens) || !draft.providerId || !draft.apiModelId ||
      !fits(other, route.pattern === "cascade" ? policy.limits.proposalTokens : policy.limits.criticTokens) || !other.providerId || !other.apiModelId ||
      draft.providerId === other.providerId && draft.apiModelId === other.apiModelId) {
      diagnostics.push({ routeId: route.id, code: "compound_route", message: "A compound role is unavailable or aliases the same actual provider/model binding. No substitute was selected." });
      continue;
    }
    if (route.pattern === "critique") {
      const review = policy.lineageReviews.find((review) => review.id === route.lineageReviewId);
      if (!review || review.draftBindingDigest !== compoundModelBinding(draft) || review.criticBindingDigest !== compoundModelBinding(other) ||
        review.draftLineage === review.criticLineage || !review.sourceText.trim() || !review.sourceText.isWellFormed() ||
        digest(review.sourceText) !== review.sourceDigest || !review.limitations.trim() || !review.limitations.isWellFormed() || !currentLineageSource(review)) {
        diagnostics.push({ routeId: route.id, code: "compound_lineage", message: "Independent critique has no exact actual-user-reviewed source claim for these model bindings. Provider families, aliases and output contracts remain unknown eligibility, not proof." });
        continue;
      }
    }
    routes.push(structuredClone(route));
  }
  if (!routes.length) throw new MoguriError(diagnostics[0]?.code ?? "compound_route", diagnostics[0]?.message ?? "No exact compound route is eligible. No classifier data was sent.", 409);
  const selectedIds = new Set(routes.flatMap((route) => [route.draftId, route.pattern === "cascade" ? route.escalationId : route.criticId]));
  return { classifier: structuredClone(classifier), candidates: structuredClone(candidates.filter((model) => selectedIds.has(model.id))),
    policy, routes, diagnostics, warning: COMPOUND_EVIDENCE_WARNING };
}
export function compoundPlan(text: string, routes: CompoundRoute[], minimumConfidence: number) {
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1 ||
    !text.isWellFormed() || Buffer.byteLength(text) > 8192) throw new MoguriError("compound_plan", "Classifier advice or threshold exceeds its exact bounded contract. No role was authorized.", 409);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("compound_plan", "Classifier output is not one exact JSON plan. No repair or fallback.", 409); throw error; }
  if (!Value.Check(CompoundRouterPlanSchema, value) || !value.reason.trim() || Buffer.byteLength(value.reason) > 1200 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.reason) || value.confidence < minimumConfidence) throw new MoguriError("compound_plan", "Classifier plan has invalid fields or does not meet the configured advice threshold. Confidence is not calibrated quality or permission.", 409);
  const plan = value, route = routes.find((route) => route.id === plan.routeId);
  if (!route || route.pattern !== plan.pattern || route.draftId !== plan.draftId ||
    plan.pattern === "cascade" && (route.pattern !== "cascade" || route.escalationId !== plan.escalationId) ||
    plan.pattern === "critique" && (route.pattern !== "critique" || route.criticId !== plan.criticId)) throw new MoguriError("compound_plan", "Classifier advice changed its eligible route or concrete model bindings. No first-route, model or endpoint fallback.", 409);
  return { route: structuredClone(route), plan: structuredClone(plan) };
}
