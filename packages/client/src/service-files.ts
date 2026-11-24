import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../protocol/src/index.ts";

export const missingServiceFile = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
export interface PrivateServiceFile { text: string; metadata: Stats }
export class ServiceFileDisappeared extends Error {
  constructor(path: string, cause: unknown) {
    super(`Moguri service metadata at ${path} disappeared during inspection. Ownership is unconfirmed; retry discovery without deleting state.`, { cause });
    this.name = "ServiceFileDisappeared";
  }
}
export class ServiceFileChanged extends Error {
  constructor(path: string) {
    super(`Moguri service metadata at ${path} changed during inspection. No different owner was adopted.`);
    this.name = "ServiceFileChanged";
  }
}

export async function readPrivateServiceFile(path: string): Promise<PrivateServiceFile> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (metadata.nlink === 0) throw new ServiceFileDisappeared(path, new Error("The original opened metadata was unlinked before inspection."));
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
      throw new ServiceFileChanged(path);
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

// Every service that claims the writer lock rotates this private generation. A launched process carries the generation its
// client observed and refuses ownership once another service has held the lock since, so a slow launch cannot outlive the race it lost.
export const SERVICE_LAUNCH_GENERATION_ENV = "MOGURI_SERVICE_LAUNCH_GENERATION";
const GENERATION = /^[a-f0-9]{32}$/;
const generationPath = (stateDir: string) => join(stateDir, "service.generation");
export interface ServiceLaunch { generation: string | null }
export async function readServiceGeneration(stateDir: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    let file: PrivateServiceFile;
    try { file = await readPrivateServiceFile(generationPath(stateDir)); }
    catch (error) {
      if (missingServiceFile(error)) return null;
      // A starting service replaces the generation atomically; read its replacement.
      if (attempt < 5 && (error instanceof ServiceFileDisappeared || error instanceof ServiceFileChanged)) continue;
      throw error;
    }
    if (!GENERATION.test(file.text)) throw new Error("The private Moguri service.generation is invalid. Preserve it and inspect the original service; no replacement was started.");
    return file.text;
  }
}
export async function rotateServiceGeneration(stateDir: string): Promise<void> {
  const pending = join(stateDir, `service.generation-${randomBytes(8).toString("hex")}.tmp`);
  try {
    const file = await open(pending, "wx", 0o600);
    try { await file.writeFile(randomBytes(16).toString("hex")); await file.sync(); } finally { await file.close(); }
    await rename(pending, generationPath(stateDir));
  } catch (error) {
    try { await unlink(pending); }
    catch (cleanup) { if (!missingServiceFile(cleanup)) throw new AggregateError([error, cleanup], `The service generation was not published and its pending file ${pending} remains.`); }
    throw error;
  }
}
export function serviceLaunch(env: NodeJS.ProcessEnv): ServiceLaunch | undefined {
  const value = env[SERVICE_LAUNCH_GENERATION_ENV];
  if (value === undefined) return undefined;
  if (value !== "none" && !GENERATION.test(value)) throw new Error("The service launch generation is invalid. No writer lock was claimed.");
  return { generation: value === "none" ? null : value };
}
