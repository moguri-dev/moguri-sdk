import type { Message } from "@earendil-works/pi-ai";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import type { CompoundCritique, CompoundProposal } from "../../../packages/protocol/src/compound.ts";

export interface CompoundTask {
  task: string; requestPlan: string | null; requestArchitecture: string | null;
  files: Array<{ path: string; baseDigest: string; text: string | null }>;
}
export interface CompoundValidationContext {
  status: "passed" | "failed" | "partial" | "denied"; command: string; output: string; evidenceDigest: string;
}
export function compoundContext(role: "draft" | "critic" | "revision" | "escalation", task: CompoundTask,
  previous: { proposal?: CompoundProposal; validation?: CompoundValidationContext; critique?: CompoundCritique } = {}): Message[] {
  if ([task.task, task.requestPlan, task.requestArchitecture, ...task.files.flatMap((file) => [file.path, file.text])].some((text) => text !== null && !text.isWellFormed())) throw new MoguriError("compound_context", "Original task/context/file text must remain lossless Unicode. No JSON escaping, normalization or truncation was used to hide invalid source.", 409);
  if (role !== "draft" && (!previous.proposal || !previous.validation) || role === "revision" && !previous.critique) throw new MoguriError("compound_context", "This role lacks its exact earlier proposal, test evidence or critique. No blank result or hidden history was substituted.", 409);
  const input = { task: task.task, untrustedRequestPlan: task.requestPlan, untrustedRequestArchitecture: task.requestArchitecture,
    untrustedSelectedFiles: task.files,
    ...(role !== "draft" ? { untrustedProposal: previous.proposal, untrustedValidationEvidence: previous.validation } : {}),
    ...(role === "revision" ? { untrustedCritique: previous.critique } : {}) };
  const text = JSON.stringify(input);
  if (!text.isWellFormed()) throw new MoguriError("compound_context", "Role context must remain lossless Unicode. No normalization or truncation was authorized.", 409);
  return [{ role: "user", content: text, timestamp: 0 }];
}
