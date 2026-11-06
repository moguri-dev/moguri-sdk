import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MoguriError, parse, PROTOCOL_VERSION } from "../../../packages/protocol/src/index.ts";
import { ModelReadinessBindingSchema, type ModelReadinessBinding } from "../../../packages/protocol/src/model-readiness-transport.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";

export const modelReadinessRootDigest = (binding: ModelReadinessBinding): string =>
  createHash("sha256").update(JSON.stringify({ root: binding.root, storage: binding.storage, storagePath: binding.storagePath })).digest("hex");

function storageFailure(error: unknown): null {
  const code = error instanceof Error && "code" in error ? error.code : null;
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") return null;
  if (error instanceof MoguriError) throw new MoguriError("model_readiness_storage", "The exact configured readiness storage location is not a canonical directory. No alias, replacement or fallback filesystem was used.", 409);
  throw error;
}
async function storageIdentity(path: string) {
  try { return await sourceRoot(path); } catch (error) { return storageFailure(error); }
}
function storageIdentitySync(path: string) {
  try { return sourceRootSync(path); } catch (error) { return storageFailure(error); }
}
export function assertModelReadinessBindingCurrent(binding: ModelReadinessBinding, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (binding.root && JSON.stringify(sourceRootSync(binding.root.root)) !== JSON.stringify(binding.root) ||
    JSON.stringify(storageIdentitySync(binding.storagePath)) !== JSON.stringify(binding.storage)) {
    throw new MoguriError("model_readiness_stale", "The exact readiness execution/storage directory changed. No another-root or replacement-filesystem evidence was adopted.", 409);
  }
}

export async function captureModelReadinessBinding(root: string | null, storagePath: string, signal: AbortSignal,
  executingModule: string = import.meta.url): Promise<ModelReadinessBinding> {
  signal.throwIfAborted();
  const identity = root === null ? null : await sourceRoot(root);
  const storage = await storageIdentity(storagePath);
  if (identity && identity.root !== root) throw new MoguriError("model_readiness_stale", "The readiness root is not its original canonical directory. No alias or fallback was used.", 409);
  const inputs = [await readFile(new URL(executingModule))];
  if (executingModule.endsWith(".ts")) {
    inputs.push(await readFile(new URL("./model-readiness.ts", import.meta.url)));
    if (executingModule !== import.meta.url) inputs.push(await readFile(fileURLToPath(import.meta.url)));
  }
  signal.throwIfAborted();
  const binding = parse(ModelReadinessBindingSchema, {
    root: identity, storage, storagePath,
    buildDigest: createHash("sha256").update(`moguri-readiness-build-v1\0${PROTOCOL_VERSION}\0`)
      .update(Buffer.concat(inputs)).digest("hex"),
  });
  assertModelReadinessBindingCurrent(binding, signal);
  return binding;
}
