import { constants, type Stats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { isRecord } from "../../protocol/src/index.ts";

export const missingServiceFile = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
export interface PrivateServiceFile { text: string; metadata: Stats }
export class ServiceFileDisappeared extends Error {
  constructor(path: string, cause: unknown) {
    super(`Moguri service metadata at ${path} disappeared during inspection. Ownership is unconfirmed; retry discovery without deleting state.`, { cause });
    this.name = "ServiceFileDisappeared";
  }
}

export async function readPrivateServiceFile(path: string): Promise<PrivateServiceFile> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || metadata.nlink !== 1 || metadata.size > 16_384) {
      throw new Error(`Moguri service metadata at ${path} is not a bounded private user-owned regular file. No owner or state was replaced.`);
    }
    const bytes = Buffer.alloc(16_385);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const result = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!result.bytesRead) break;
      bytesRead += result.bytesRead;
    }
    let current: Stats;
    try { current = await lstat(path); }
    catch (error) {
      if (!missingServiceFile(error)) throw error;
      throw new ServiceFileDisappeared(path, error);
    }
    if (bytesRead > 16_384 || bytesRead !== metadata.size || metadata.dev !== current.dev || metadata.ino !== current.ino ||
      metadata.size !== current.size || metadata.mtimeMs !== current.mtimeMs || metadata.ctimeMs !== current.ctimeMs) {
      throw new Error(`Moguri service metadata at ${path} changed during inspection. No different owner was adopted.`);
    }
    return { text: bytes.subarray(0, bytesRead).toString("utf8"), metadata };
  } finally { await file.close(); }
}

export async function assertOwnedServiceFile(path: string, original: PrivateServiceFile, allowMissing = false): Promise<boolean> {
  let current: PrivateServiceFile;
  try { current = await readPrivateServiceFile(path); }
  catch (error) { if (allowMissing && (missingServiceFile(error) || error instanceof ServiceFileDisappeared)) return false; throw error; }
  if (current.metadata.dev !== original.metadata.dev || current.metadata.ino !== original.metadata.ino || current.text !== original.text) {
    throw new Error(`Moguri service metadata at ${path} no longer belongs to this owner. Cleanup is unconfirmed; the replacement was preserved.`);
  }
  return true;
}

export async function removeOwnedServiceFile(path: string, original: PrivateServiceFile, allowMissing = false): Promise<void> {
  if (!await assertOwnedServiceFile(path, original, allowMissing)) return;
  try { await unlink(path); }
  catch (error) { if (!allowMissing || !missingServiceFile(error)) throw error; }
}

export async function readServiceLock(path: string): Promise<(PrivateServiceFile & { pid: number | null }) | null> {
  let file: PrivateServiceFile;
  try { file = await readPrivateServiceFile(path); }
  catch (error) { if (missingServiceFile(error)) return null; throw error; }
  if (!file.text) return { ...file, pid: null };
  let value: unknown;
  try { value = JSON.parse(file.text); }
  catch (error) { throw new Error("The private Moguri service.lock is invalid. Preserve it and inspect the original service; no replacement was started.", { cause: error }); }
  if (!isRecord(value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 2) {
    throw new Error("The private Moguri service.lock has no valid owner. Preserve it and inspect the original service; no replacement was started.");
  }
  return { ...file, pid: value.pid };
}
