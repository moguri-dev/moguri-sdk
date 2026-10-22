import { createHash } from "node:crypto";
import {
  CandidateDocumentSchema, CandidatePatchSchema, MAX_CANDIDATE_PATCH_BYTES, MoguriError, parse, sameCandidateRoot, sameCandidateRoleOrigin,
  type CandidateDocument, type CandidatePatch, type CandidateRecord,
} from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath, readProjectFile, scopedPath } from "./files.ts";
import { digest } from "./store.ts";
import { inspectProjectDirectory } from "./project-directory.ts";

export const candidateDigest = (text: string) => createHash("sha256").update("moguri-candidate-v1\0").update(text).digest("hex");
export function candidatePatch(value: unknown): CandidatePatch {
  const patch = parse(CandidatePatchSchema, value);
  if (Buffer.byteLength(JSON.stringify(patch)) > MAX_CANDIDATE_PATCH_BYTES || !patch.summary.isWellFormed() ||
    new Set(patch.edits.map(({ path }) => path.normalize("NFC").toLowerCase())).size !== patch.edits.length ||
    patch.edits.some(({ path, text }) => !path.isWellFormed() || !text.isWellFormed() || text.includes("\0") || path.startsWith("/") ||
      /[\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") || isProtectedProjectPath(path))) {
    throw new MoguriError("candidate_patch", "Use a bounded 32-KiB non-binary UTF-8 patch with unique portable relative, unprotected paths. No file was changed.", 409);
  }
  return structuredClone(patch);
}
export async function candidateFileBase(root: string, path: string): Promise<string> {
  try { await scopedPath(root, path, true); return (await readProjectFile(root, path)).digest; }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await inspectProjectDirectory(root, path);
    return "absent";
  }
}
export async function candidateBases(root: string, patch: CandidatePatch): Promise<void> {
  for (const edit of patch.edits) if (await candidateFileBase(root, edit.path) !== edit.baseDigest) throw new MoguriError("candidate_conflict", `The recorded base changed at ${edit.path}. Existing source content was preserved.`, 409);
}
export async function candidateBytes(root: string, patch: CandidatePatch) {
  const files: Array<{ path: string; digest: string; bytes: number }> = [];
  for (const edit of patch.edits) {
    const file = await readProjectFile(root, edit.path);
    if (file.text !== edit.text || file.digest !== digest(edit.text)) throw new MoguriError("candidate_changed", `Candidate bytes changed at ${edit.path}. Inspect newer content; no verified completion was inferred.`, 409);
    files.push({ path: edit.path, digest: file.digest, bytes: file.bytes });
  }
  return files;
}
export function candidateDocument(text: string, record: CandidateRecord): CandidateDocument {
  if (Buffer.byteLength(text) > 64 * 1024 || digest(text) !== record.documentDigest || candidateDigest(text) !== record.proposalDigest) throw new MoguriError("candidate_document", "The retained candidate document no longer matches its exact recorded digests.", 409);
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { if (error instanceof SyntaxError) throw new MoguriError("candidate_document", "The retained candidate document is not valid versioned JSON.", 409); throw error; }
  const document = parse(CandidateDocumentSchema, value), patch = candidatePatch(document.patch);
  if (!sameCandidateRoot(document.source, record.source) || !sameCandidateRoot(document.stage, record.stage) || !sameCandidateRoleOrigin(document.roleOrigin, record.roleOrigin) ||
    JSON.stringify(document.compoundOrigin) !== JSON.stringify(record.compoundOrigin) ||
    JSON.stringify(patch.edits.map(({ path }) => path)) !== JSON.stringify(record.paths)) throw new MoguriError("candidate_document", "Retained candidate roots or ordered paths disagree with their original record.", 409);
  return { ...document, patch };
}
