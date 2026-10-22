import { MoguriError, parse } from "../../../packages/protocol/src/index.ts";
import { CompoundCritiqueSchema, CompoundProposalSchema } from "../../../packages/protocol/src/compound.ts";
import { candidatePatch } from "./candidate-files.ts";

function boundedJson(text: string): unknown {
  if (!text.trim() || !text.isWellFormed() || Buffer.byteLength(text) > 32 * 1024) throw new MoguriError("compound_result", "Compound role output must remain within its exact lossless 32-KiB JSON contract. No output was truncated or accepted.", 409);
  try { return JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("compound_result", "Compound role output is not one exact JSON object. No Markdown repair or next role was authorized.", 409); throw error; }
}
export function compoundProposal(text: string, files: Array<{ path: string; baseDigest: string; text: string | null }>) {
  const value = parse(CompoundProposalSchema, boundedJson(text)), patch = candidatePatch(value.patch);
  if (!value.plan.trim() || !value.architecture.trim() || !value.plan.isWellFormed() || !value.architecture.isWellFormed() ||
    patch.edits.some((edit) => !files.some((file) => file.path === edit.path && file.baseDigest === edit.baseDigest))) throw new MoguriError("compound_proposal", "Plan/architecture must be bounded lossless data and implementation edits must keep only the exact reviewed paths and original bases. No staging or source acceptance.", 409);
  return { ...value, patch };
}
export function compoundCritique(text: string) {
  const value = parse(CompoundCritiqueSchema, boundedJson(text)), parts = [value.plan, value.architecture, value.implementation];
  const verdict = parts.some((part) => part.verdict === "reject") ? "reject" : parts.some((part) => part.verdict === "revise") ? "revise" : "pass";
  if (value.verdict !== verdict || parts.some((part) => !part.reason.trim() || !part.reason.isWellFormed() || Buffer.byteLength(part.reason) > 1200 ||
    part.issues.some((issue) => !issue.trim() || !issue.isWellFormed() || Buffer.byteLength(issue) > 1200))) {
    throw new MoguriError("compound_critique", "Critic verdict contradicts its bounded plan/architecture/implementation observations. No quality, permission or acceptance was inferred.", 409);
  }
  return value;
}
