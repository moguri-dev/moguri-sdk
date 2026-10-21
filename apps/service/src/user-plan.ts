import { Type, type Static } from "typebox";
import { MAX_TEXT, MoguriError, parse, PlanFileResultSchema, type PlanFileResult, type SessionMode } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";
import { digest } from "./store.ts";
import { assertFolderName, type FolderPolicy } from "./project-policy.ts";
import { prepareProjectDirectory } from "./project-directory.ts";

export const UserPlanInputSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 4096 }), text: Type.String({ maxLength: MAX_TEXT }),
  expectedDigest: Type.String({ pattern: "^(absent|[a-f0-9]{64})$" }),
}, { additionalProperties: false });
export type UserPlanInput = Static<typeof UserPlanInputSchema>;
export const UserPlanResultSchema = PlanFileResultSchema;
export type UserPlanResult = PlanFileResult;

export async function executeUserPlan(root: string, requested: UserPlanInput, signal: AbortSignal, safety: { mode: SessionMode; folders: FolderPolicy }): Promise<UserPlanResult> {
  const input = parse(UserPlanInputSchema, requested);
  const createdDirectories: string[] = [];
  let attempted = false, written = false, readback = false;
  try {
    signal.throwIfAborted();
    if (safety.mode !== "agent") throw new MoguriError("read_only", "This session cannot edit a plan.", 403);
    if (!input.text.isWellFormed() || input.text.includes("\0")) throw new MoguriError("plan_text", "Plan text must be valid non-binary Unicode. No replacement characters or filesystem effects were introduced.");
    if (Buffer.byteLength(input.text) > MAX_TEXT) throw new MoguriError("file_limit", "Plan writes are limited to 128 KiB.");
    assertFolderName(input.path, true, safety.folders);
    await prepareProjectDirectory(root, input.path, { signal, created: (path) => createdDirectories.push(path) });
    signal.throwIfAborted(); attempted = true;
    await writeProjectFile(root, input.path, input.text, input.expectedDigest, { signal, committed: () => { written = true; } });
    const current = await readProjectFile(root, input.path);
    readback = current.text === input.text && current.digest === digest(input.text);
    if (!readback) throw new MoguriError("plan_readback", "The plan changed after this exact write. Its effect is retained, but current bytes need inspection.", 409);
    signal.throwIfAborted();
    return { path: input.path, outcome: "completed", fileOutcome: "written", createdDirectories,
      text: current.text, digest: current.digest, bytes: current.bytes, readback, diagnostic: null };
  } catch (error) {
    const knownNoWrite = error instanceof MoguriError && ["file_conflict", "file_limit", "path_denied"].includes(error.code) || signal.aborted && error === signal.reason;
    const uncertain = attempted && !written && !knownNoWrite;
    const partial = written || uncertain || createdDirectories.length > 0;
    const outcome = partial ? "partial" : signal.aborted ? "stopped" : "failed";
    if (!(error instanceof MoguriError) && !signal.aborted) console.error("User plan mutation failed:", error instanceof Error && "code" in error ? String(error.code) : "plan_write");
    const reason = error instanceof MoguriError ? error.message : signal.aborted ? "Owned plan save was stopped." : "Plan filesystem work failed. Inspect the exact operation before retrying.";
    return { path: input.path, outcome, fileOutcome: written ? "written" : uncertain ? "unconfirmed" : "not-started", createdDirectories,
      text: written ? input.text : null, digest: written ? digest(input.text) : null, bytes: written ? Buffer.byteLength(input.text) : null, readback,
      diagnostic: partial ? `${reason} Filesystem effects may already exist; no rollback or complete save was inferred.` : reason };
  }
}
