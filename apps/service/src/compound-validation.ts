import { Type, type Static } from "typebox";
import { CandidatePatchSchema, CandidateRootSchema, MoguriError, parse, sameCandidateRoot, type CompoundValidationResult } from "../../../packages/protocol/src/index.ts";
import { candidateBytes } from "./candidate-files.ts";
import { candidateGitState, readGitBinding } from "./project-git.ts";
import { sourceRoot } from "./repository-source.ts";
import { runCommand } from "./supervisor.ts";
import { digest } from "./store.ts";
import { CandidateWorkerScopeSchema } from "./candidate-worker-protocol.ts";
import { candidateIdentity, candidateWorkerState } from "./candidate-worker.ts";
import { CandidateNativeRootGrantSchema } from "../../../packages/protocol/src/candidate-workspaces.ts";

export const CompoundValidationOperationSchema = Type.Object({
  kind: Type.Literal("compound.validation"), workflowId: Type.String({ minLength: 1, maxLength: 128 }),
  validationId: Type.String({ minLength: 1, maxLength: 128 }), candidateId: Type.String({ minLength: 1, maxLength: 128 }),
  stage: CandidateRootSchema, patch: CandidatePatchSchema, command: Type.String({ minLength: 1, maxLength: 16384 }),
  timeoutMs: Type.Integer({ minimum: 100, maximum: 120_000 }),
  reviewDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), stateDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  source: Type.Optional(CandidateRootSchema), scope: Type.Optional(CandidateWorkerScopeSchema),
  nativeRoots: Type.Optional(Type.Array(CandidateNativeRootGrantSchema, { minItems: 2, maxItems: 2 })),
}, { additionalProperties: false });
export type CompoundValidationOperation = Static<typeof CompoundValidationOperationSchema>;
export async function compoundCandidateState(stage: CompoundValidationOperation["stage"], patch: CompoundValidationOperation["patch"], signal: AbortSignal) {
  if (stage.env !== "Local") throw new MoguriError("compound_validation_env", "Non-Local project tests require their exact owned peer/native scope, not this Local filesystem helper.", 409);
  const identity = await sourceRoot(stage.root), git = await readGitBinding(stage.root, signal);
  if (!sameCandidateRoot(stage, { ...stage, ...identity, ...git })) throw new MoguriError("compound_validation_root", "The exact reviewed candidate directory or Git base changed. No root substitution or command replay.", 409);
  const files = await candidateBytes(stage.root, patch), state = await candidateGitState(stage.root, signal);
  signal.throwIfAborted();
  return digest(JSON.stringify({ stage, files, state }));
}
export async function executeCompoundValidation(value: CompoundValidationOperation, signal: AbortSignal, output: (text: string) => void, started: (pid: number) => void): Promise<CompoundValidationResult> {
  const operation = structuredClone(parse(CompoundValidationOperationSchema, value));
  const identities = operation.scope ? candidateIdentity(operation.scope, operation.nativeRoots ? async (guest) => {
    const grant = operation.nativeRoots!.find((grant) => grant.root === guest.root);
    if (!grant) throw new MoguriError("compound_validation_identity", "This waiting native parent has no original retained private-root grant. No command was authorized.", 409);
    return grant;
  } : undefined) : undefined;
  const state = async (signal: AbortSignal) => {
    if (operation.stage.env === "Local") {
      if (operation.scope || operation.source) throw new MoguriError("compound_validation_env", "Historical Local validation cannot acquire a peer/native scope.", 409);
      return compoundCandidateState(operation.stage, operation.patch, signal);
    }
    if (!operation.scope || !operation.source || operation.source.env !== operation.scope.env || operation.stage.env !== operation.scope.env) {
      throw new MoguriError("compound_validation_env", "Original selected Env validation has no exact source/scope. No controller Git or source fallback.", 409);
    }
    return candidateWorkerState(operation.scope, operation.source, operation.stage, operation.patch, signal, identities);
  };
  if (await state(signal) !== operation.stateDigest) throw new MoguriError("compound_validation_changed", "Reviewed candidate bytes/index/worktree changed before this exact test command. No execution or fallback.", 409);
  const result = await runCommand(operation.stage.root, operation.command, operation.timeoutMs, signal, output, started);
  let candidateUnchanged = false, diagnostic: string | null = null;
  try { candidateUnchanged = await state(AbortSignal.timeout(5000)) === operation.stateDigest; }
  catch (error) {
    if (!(error instanceof MoguriError)) console.error("Compound candidate readback failed:", error instanceof Error && "code" in error ? String(error.code) : "compound_readback");
    diagnostic = error instanceof MoguriError ? error.message : "Actual candidate readback failed. No passing validation or changed bytes were adopted.";
  }
  const outcome = signal.aborted || result.outcome === "partial" || !candidateUnchanged ? "partial" : result.outcome === "completed" ? "completed" : "failed";
  if (!candidateUnchanged) diagnostic ??= "The test changed candidate bytes, tracked/index state or nonignored paths. Keep the original proposal and actual changed worktree separate; no formatter output was adopted.";
  if (outcome === "partial") diagnostic ??= "Command stop/cleanup is partial. Detached/reparented containment remains unproven; no successful validation or continuation.";
  return { version: operation.stage.env === "Local" ? 1 : 2, validationId: operation.validationId, candidateId: operation.candidateId, stage: operation.stage, commandDigest: digest(operation.command),
    text: result.text, isError: result.isError || outcome === "partial", outcome, exitCode: result.exitCode, signal: result.signal, candidateUnchanged, diagnostic };
}
