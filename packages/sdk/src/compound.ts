import { ClientError } from "../../client/src/index.ts";
import {
  COMPOUND_EVIDENCE_WARNING, CompoundLineageInputSchema, CompoundLineageReviewSchema, compoundModelBindingText, parse,
  type CompoundLineageInput, type CompoundLineageReview, type ModelInfo,
} from "../../protocol/src/index.ts";

const hash = async (text: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
export async function lineageDraft(models: () => ModelInfo[], value: CompoundLineageInput) {
  const input = structuredClone(parse(CompoundLineageInputSchema, value)), catalog = models();
  const draft = catalog.find((model) => model.id === input.draftModelId), critic = catalog.find((model) => model.id === input.criticModelId);
  if (!draft || !critic || draft.synthetic || critic.synthetic || !draft.providerId || !critic.providerId || !draft.apiModelId || !critic.apiModelId ||
    draft.providerId === critic.providerId && draft.apiModelId === critic.apiModelId ||
    !input.sourceText.trim() || !input.sourceText.isWellFormed() || !input.limitations.trim() || !input.limitations.isWellFormed() ||
    input.draftLineage.trim().normalize("NFC").toLowerCase() === input.criticLineage.trim().normalize("NFC").toLowerCase()) throw new ClientError("compound_lineage", "Choose exact distinct available model bindings and a bounded reviewed source/limitations claim. Names and provider declarations cannot supply training independence.");
  const url = new URL(input.sourceUrl), now = new Date().toISOString(), until = Date.parse(input.validUntil);
  if (url.protocol !== "https:" || url.username || url.password || !Number.isFinite(until) || new Date(until).toISOString() !== input.validUntil ||
    until <= Date.parse(now)) throw new ClientError("compound_lineage", "Use a credential-free HTTPS source and an explicit future UTC expiry. No source was fetched or inferred.");
  const draftBinding = compoundModelBindingText(draft), criticBinding = compoundModelBindingText(critic);
  const [draftBindingDigest, criticBindingDigest, sourceDigest] = await Promise.all([hash(draftBinding), hash(criticBinding), hash(input.sourceText)]);
  const current = models(), currentDraft = current.find((model) => model.id === draft.id), currentCritic = current.find((model) => model.id === critic.id);
  if (!currentDraft || !currentCritic || compoundModelBindingText(currentDraft) !== draftBinding || compoundModelBindingText(currentCritic) !== criticBinding) throw new ClientError("compound_lineage_stale", "Actual model bindings changed during draft preparation. No saved review or eligibility was created.");
  const review: CompoundLineageReview = parse(CompoundLineageReviewSchema, { version: 1, id: crypto.randomUUID(), actor: "user",
    draftBindingDigest, criticBindingDigest, draftLineage: input.draftLineage, criticLineage: input.criticLineage,
    sourceKind: input.sourceKind, sourceUrl: input.sourceUrl, sourceText: input.sourceText, sourceDigest, reviewedAt: now, validUntil: input.validUntil, limitations: input.limitations });
  return { review, warning: `Unpersisted draft only. Explicitly save this reviewed claim in the actual profile policy before eligibility can change. ${COMPOUND_EVIDENCE_WARNING}` };
}
