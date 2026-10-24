import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/index.ts";

const filename = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.wav$/;
async function owned(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || await realpath(directory) !== resolve(directory)) {
    throw new MoguriError("speech_spool", "The private speech staging directory changed ownership, mode or identity. No audio was written or removed.", 409);
  }
}
export async function cleanupSpeechSpool(stateDir: string): Promise<void> {
  const directory = join(await realpath(stateDir), "speech-captures");
  try { await owned(directory); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), metadata = await lstat(path);
    if (!filename.test(entry.name) || !metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077) {
      throw new MoguriError("speech_cleanup", "An unrecognized or changed private speech staging entry was retained. Inspect the speech-captures directory before recording.", 409);
    }
    await unlink(path);
  }
}
export async function withSpeechSpool<T>(stateDir: string, id: string, bytes: Uint8Array, signal: AbortSignal, transcribe: (path: string) => Promise<T>): Promise<T> {
  if (!filename.test(`${id}.wav`)) throw new MoguriError("speech_scope", "The audio staging owner is invalid.");
  const directory = join(await realpath(stateDir), "speech-captures");
  await mkdir(directory, { recursive: true, mode: 0o700 }); await owned(directory);
  const path = join(directory, `${id}.wav`), file = await open(path, "wx", 0o600);
  try {
    signal.throwIfAborted();
    await file.writeFile(bytes); await file.sync(); await file.close();
    signal.throwIfAborted(); return await transcribe(path);
  } finally {
    bytes.fill(0); await file.close(); await owned(directory);
    await unlink(path);
  }
}
