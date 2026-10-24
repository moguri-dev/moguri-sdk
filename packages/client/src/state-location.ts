import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isRecord, parse, StateLocationSchema, type StateLocation } from "../../protocol/src/index.ts";

const safeId = /^[A-Za-z0-9_-]{1,128}$/;
export const stateLocationDirectory = () => process.env.MOGURI_LOCATION_DIR ? resolve(process.env.MOGURI_LOCATION_DIR) :
  process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Moguri Location") : join(homedir(), ".local", "state", "moguri-location");
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
function readPrivateJson(path: string): unknown {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(file);
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || metadata.size > 64 * 1024 || metadata.nlink !== 1) throw new Error("The private state locator changed ownership, type, mode or size. No root was substituted.");
    return JSON.parse(readFileSync(file, "utf8"));
  } finally { closeSync(file); }
}
function locatorRoot(directory: string): string {
  if (lstatSync(directory).isSymbolicLink()) throw new Error("The private locator directory cannot be a symbolic link.");
  const root = realpathSync(directory), file = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const metadata = fstatSync(file); if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077) throw new Error("The state locator must be a private user-owned directory."); }
  finally { closeSync(file); }
  return root;
}
export function readStateLocation(directory: string, keyId: string): StateLocation | null {
  if (!safeId.test(keyId)) throw new Error("The whole-store identity is invalid. No state alias was followed.");
  let value: unknown;
  try { value = readPrivateJson(join(locatorRoot(directory), `${keyId}.json`)); } catch (error) { if (missing(error)) return null; throw error; }
  const location = parse(StateLocationSchema, value);
  if (location.keyId !== keyId || [location.dataDir, location.resourceBase, location.move.source, location.move.destination].some((path) => !isAbsolute(path))) throw new Error("State location metadata is invalid. Preserve the original store and locator; no empty fallback was created.");
  return location;
}
export function readDefaultStateLocation(directory = stateLocationDirectory()): StateLocation | null {
  let value: unknown;
  try { value = readPrivateJson(join(locatorRoot(directory), "default.json")); } catch (error) { if (missing(error)) return null; throw error; }
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.keyId !== "string" || !safeId.test(value.keyId)) throw new Error("The default store locator is invalid. No replacement store was created.");
  const location = readStateLocation(directory, value.keyId);
  if (!location) throw new Error("The authoritative store location is missing. Restore its exact private locator; no old or empty fallback was used.");
  return location;
}
export async function privateLocationDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return locatorRoot(directory);
}
async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  const root = await privateLocationDirectory(directory), path = join(root, name);
  try { readPrivateJson(path); } catch (error) { if (!missing(error)) throw error; }
  const pending = join(root, `.location-${randomUUID()}.tmp`), file = await open(pending, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value)); await file.sync(); await file.close();
    await rename(pending, path);
    const parent = await open(root, "r"); try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) {
    await file.close();
    await unlink(pending).catch((cleanup: unknown) => { if (!missing(cleanup)) throw new AggregateError([error, cleanup], "State locator publication and exact temporary-file cleanup failed."); });
    throw error;
  }
}
export async function writeStateLocation(directory: string, location: StateLocation): Promise<void> {
  if (!safeId.test(location.keyId)) throw new Error("A canonical whole-store key identity is required.");
  await writeJson(directory, `${location.keyId}.json`, location);
}
export async function setDefaultStateLocation(directory: string, keyId: string): Promise<void> {
  const current = readDefaultStateLocation(directory);
  if (current && current.keyId !== keyId) throw new Error("Another whole store owns default discovery. No default or explicit override was replaced.");
  await writeJson(directory, "default.json", { schemaVersion: 1, keyId });
}
export function processMayExist(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; }
}
export async function claimStoreIdentity(directory: string, keyId: string, dataDir: string): Promise<() => Promise<void>> {
  if (!safeId.test(keyId)) throw new Error("A canonical whole-store identity is required before claiming a writer.");
  const root = await privateLocationDirectory(directory), path = join(root, `writer-${keyId}.lock`);
  const location = readStateLocation(root, keyId), actual = await realpath(dataDir);
  if (location && location.dataDir !== actual) throw new Error("This copied or retired root is no longer the authoritative store. No stale writer was opened.");
  if (location?.move.status === "moving") {
    if (processMayExist(location.move.ownerPid)) throw new Error("The original relocation owner may still be writing. Inspect it; no second writer or copy was started.");
    await writeStateLocation(root, { ...location, move: { ...location.move, status: "partial", diagnostic: "Relocation was interrupted. Original source and partial destination were preserved; no copy or publication was replayed." } });
  }
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const previous = readPrivateJson(path);
    if (!isRecord(previous) || typeof previous.pid !== "number" || !Number.isSafeInteger(previous.pid) || previous.pid < 1 || processMayExist(previous.pid)) throw new Error("Another or unconfirmed writer holds this whole-store identity. No copied root was adopted.");
    const before = await lstat(path);
    const original = await readFile(path, "utf8");
    const after = await lstat(path);
    if (before.ino !== after.ino || before.dev !== after.dev || JSON.stringify(previous) !== original) throw new Error("The original whole-store lease changed. No lease was removed.");
    await unlink(path); file = await open(path, "wx", 0o600);
  }
  const token = randomUUID(), text = JSON.stringify({ pid: process.pid, token, keyId, dataDir: actual });
  await file.writeFile(text); await file.sync();
  return async () => {
    const held = await file.stat(), current = await lstat(path);
    if (held.ino !== current.ino || held.dev !== current.dev || await readFile(path, "utf8") !== text) throw new Error("Whole-store writer cleanup is unconfirmed. The exact lease was retained.");
    await unlink(path); await file.close();
  };
}
export async function waitForStorageRelocation(directory: string, id: string, keyId: string, timeoutMs = 120_000): Promise<StateLocation> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = readStateLocation(directory, keyId);
    if (value?.move.id !== id) throw new Error("The exact relocation identity is missing or changed. No newer operation was substituted.");
    if (value.move.status === "published" || value.move.status === "completed") return value;
    if (value.move.status === "partial") throw new Error(value.move.diagnostic ?? "Relocation is partial. Original source and destination were preserved.");
    if (!processMayExist(value.move.ownerPid)) throw new Error("Relocation owner exited without publication. Inspect retained source/destination; no copy was replayed.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("Relocation is still unconfirmed. Inspect the original operation before restarting or retrying.");
}
