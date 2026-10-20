import { constants } from "node:fs";
import { isUtf8 } from "node:buffer";
import { open, realpath, lstat, stat, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_TEXT, MoguriError } from "../../../packages/protocol/src/index.ts";
import { digest } from "./store.ts";

const protectedPart = (part: string) => part === ".git" || part === ".moguri" || part.startsWith(".moguri-dependencies-") || part === "node_modules" ||
  [".ssh", ".aws", ".azure", ".kube", ".docker", ".npmrc", ".pypirc", ".netrc", ".git-credentials", "Moguri"].includes(part) ||
  /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part) ||
  /^(?:credentials|id_rsa|id_ed25519)(?:\.|$)/i.test(part);
export const isProtectedProjectPath = (input: string): boolean => input.split(/[\\/]/).some(protectedPart);
export async function scopedPath(root: string, input: string, allowMissing = false): Promise<string> {
  root = await realpath(root);
  const requested = resolve(root, input);
  const canonicalParent = await realpath(dirname(requested));
  const path = join(canonicalParent, basename(requested));
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.split(/[\\/]/).some(protectedPart)) {
    throw new MoguriError("path_denied", "Choose an unprotected file inside the approved project.");
  }
  const parentRel = relative(root, canonicalParent);
  if (isAbsolute(parentRel) || parentRel === ".." || parentRel.startsWith("../") || parentRel.split(/[\\/]/).some(protectedPart)) {
    throw new MoguriError("path_denied", "Symlinks cannot escape the approved project or enter protected paths.");
  }
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new MoguriError("path_denied", "Symlink file access is not supported. Select the real project file.");
    const canonical = await realpath(path);
    if (canonical !== path && (process.platform !== "darwin" || canonical.toLowerCase() !== path.toLowerCase())) throw new MoguriError("path_denied", "Symlink file access is not supported. Select the real project file.");
  } catch (error) {
    if (!(allowMissing && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return path;
}
export async function readProjectFile(root: string, input: string, maxBytes = MAX_TEXT): Promise<{ text: string; digest: string; bytes: number; path: string }> {
  const path = await scopedPath(root, input);
  const content = await readRegularFile(path, maxBytes);
  if (content.includes(0) || !isUtf8(content)) throw new MoguriError("file_limit", "The file is binary or not valid UTF-8.");
  const text = content.toString("utf8");
  return { text, digest: digest(text), bytes: content.length, path: relative(await realpath(root), path) };
}
export async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) throw new MoguriError("file_limit", `Only regular files up to ${Math.ceil(maxBytes / 1024)} KiB are supported.`);
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead);
    if (bytesRead > maxBytes) throw new MoguriError("file_limit", "The file grew beyond its approved byte limit.");
    return content;
  } finally { await file.close(); }
}
export async function writeProjectFile(root: string, input: string, text: string, expectedDigest: string): Promise<string> {
  const path = await scopedPath(root, input, true);
  if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("file_limit", "File writes are limited to 128 KiB.");
  const checkBase = async () => {
    try {
      const current = await readProjectFile(root, input);
      if (expectedDigest !== current.digest) throw new MoguriError("file_conflict", "The file changed since it was read. Read it again before writing.", 409);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT" && expectedDigest === "absent") return;
      throw error;
    }
  };
  await checkBase();
  const temporary = join(dirname(path), `.moguri-write-${randomUUID()}`);
  const metadata = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  const file = await open(temporary, "wx", metadata ? metadata.mode & 0o777 : 0o600);
  try {
    await file.writeFile(text, "utf8");
    await file.sync();
    await file.close();
    await scopedPath(root, input, true);
    await checkBase();
    await rename(temporary, path);
    return digest(text);
  } finally {
    await file.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
export async function listProjectFiles(root: string, input = "."): Promise<string[]> {
  const start = input === "." ? root : await scopedPath(root, input);
  if (!(await stat(start)).isDirectory()) throw new MoguriError("not_directory", "The selected path is not a directory.");
  const entries = await readdir(start, { withFileTypes: true });
  return entries.filter((entry) => !entry.isSymbolicLink() && !protectedPart(entry.name))
    .slice(0, 1000).map((entry) => relative(root, join(start, entry.name)) + (entry.isDirectory() ? "/" : "")).sort();
}
