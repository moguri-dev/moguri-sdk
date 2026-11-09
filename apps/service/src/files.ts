import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isUtf8 } from "node:buffer";
import { open, realpath, lstat, stat, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { MAX_TEXT, MoguriError } from "../../../packages/protocol/src/core.ts";

const protectedPart = (part: string) => {
  const name = part.toLowerCase();
  return name === ".git" || name === ".moguri" || name.startsWith(".moguri-dependencies-") || name === "node_modules" ||
    [".ssh", ".aws", ".azure", ".kube", ".docker", ".npmrc", ".pypirc", ".netrc", ".git-credentials", "moguri"].includes(name) ||
    /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) ||
    /^(?:credentials|id_rsa|id_ed25519)(?:\.|$)/i.test(name);
};
export const isProtectedProjectPath = (input: string): boolean => input.split(/[\\/]/).some(protectedPart);
export function scopedPathSync(root: string, input: string, allowMissing = false): string {
  const path = resolve(root, input), rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || isProtectedProjectPath(rel) || realpathSync(root) !== root) {
    throw new MoguriError("path_denied", "Choose an unprotected file at the exact canonical root.");
  }
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new MoguriError("path_denied", "Symlink/alias snapshot paths are unsupported.");
    } catch (error) {
      if (!(allowMissing && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      return path;
    }
  }
  return path;
}
export function readRegularFileSync(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) throw new MoguriError("file_limit", `Only regular files up to ${maxBytes} bytes are supported; no prefix was captured.`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0, read: number;
    do { read = readSync(fd, buffer, length, buffer.length - length, length); length += read; } while (read && length < buffer.length);
    const after = fstatSync(fd, { bigint: true });
    if (length > maxBytes || BigInt(length) !== after.size || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new MoguriError("file_changed", "Source changed during exact bounded capture. No mixed snapshot was accepted.", 409);
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}
export async function scopedPath(root: string, input: string, allowMissing = false): Promise<string> {
  root = await realpath(root);
  const assertScoped = (path: string, allowRoot = false) => {
    const rel = relative(root, path);
    if (!rel && !allowRoot || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || isProtectedProjectPath(rel)) {
      throw new MoguriError("path_denied", "Choose an unprotected file inside the exact approved project; path aliases cannot acquire another root.");
    }
  };
  const requested = resolve(root, input);
  assertScoped(requested);
  let parent = root;
  for (const part of relative(root, dirname(requested)).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    if ((await lstat(parent)).isSymbolicLink()) throw new MoguriError("path_denied", "Symlink folder access is not supported. Select the real project path.");
  }
  const canonicalParent = await realpath(dirname(requested));
  assertScoped(canonicalParent, true);
  const path = join(canonicalParent, basename(requested));
  assertScoped(path);
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new MoguriError("path_denied", "Symlink file access is not supported. Select the real project file.");
    const canonical = await realpath(path);
    assertScoped(canonical);
    if (canonical !== path && (process.platform !== "darwin" || canonical.normalize("NFC").toLowerCase() !== path.normalize("NFC").toLowerCase())) throw new MoguriError("path_denied", "Symlink file access is not supported. Select the real project file.");
    return canonical;
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
  return { text, digest: bytesDigest(content), bytes: content.length, path: relative(await realpath(root), path) };
}
export function textFilePage(text: string, args: Record<string, unknown>) {
  const content = Buffer.from(text), offset = args.offset ?? 0, limit = args.limit ?? 16 * 1024, search = args.search;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > content.length ||
    typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 ||
    search !== undefined && (typeof search !== "string" || !search.length || search.length > 200 || !search.isWellFormed())) throw new MoguriError("file_page", "Use an existing UTF-8 byte offset, a 1..16,384-byte limit and an optional nonempty literal search up to 200 characters.");
  if (offset < content.length && (content[offset]! & 0xc0) === 0x80) throw new MoguriError("file_page", "The byte offset splits a UTF-8 character. Use the returned nextOffset.");
  const found = typeof search === "string" ? content.indexOf(Buffer.from(search), offset) : null;
  if (found === -1) return { text: "", bytes: content.length, offset, nextOffset: null, matchOffset: null, eof: true, search };
  const start = found ?? offset;
  let end = Math.min(start + limit, content.length);
  while (end < content.length && (content[end]! & 0xc0) === 0x80) end--;
  if (end === start && start < content.length) throw new MoguriError("file_page", "The byte limit cannot contain this UTF-8 character. Increase it, up to 16,384 bytes.");
  return { text: content.subarray(start, end).toString("utf8"), bytes: content.length, offset: start, nextOffset: end < content.length ? end : null, eof: end === content.length,
    ...(search !== undefined ? { search, matchOffset: found } : {}) };
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
export async function writeProjectFile(root: string, input: string, text: string, expectedDigest: string, options: { signal?: AbortSignal; beforeCommit?: () => void; committed?: () => void } = {}): Promise<string> {
  if (!text.isWellFormed() || text.includes("\0")) throw new MoguriError("file_encoding", "File writes need lossless UTF-8 without NUL.");
  if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("file_limit", "File writes are limited to 128 KiB.");
  try { await readProjectFile(root, input); }
  catch (error) { if (!(expectedDigest === "absent" && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  return writeProjectBytes(root, input, Buffer.from(text), expectedDigest, options);
}
export const bytesDigest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export async function writeProjectBytes(root: string, input: string, bytes: Buffer, expectedDigest: string, options: { signal?: AbortSignal; beforeCommit?: () => void; committed?: () => void } = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const path = await scopedPath(root, input, true);
  if (bytes.length > 8 * 1024 * 1024) throw new MoguriError("file_limit", "Structured binary writes are limited to 8 MiB.");
  const checkBase = async () => {
    try {
      const current = await readRegularFile(await scopedPath(root, input), 8 * 1024 * 1024);
      if (expectedDigest !== bytesDigest(current)) throw new MoguriError("file_conflict", "The file changed since it was read. Read it again before writing.", 409);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT" && expectedDigest === "absent") return;
      throw error;
    }
  };
  await checkBase();
  const temporary = join(dirname(path), `.moguri-write-${randomUUID()}`);
  const metadata = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  const mode = metadata ? metadata.mode & 0o777 : 0o600, file = await open(temporary, "wx", mode);
  try {
    await file.writeFile(bytes);
    await file.chmod(mode);
    await file.sync();
    await file.close();
    await scopedPath(root, input, true);
    await checkBase();
    options.signal?.throwIfAborted();
    options.beforeCommit?.();
    options.signal?.throwIfAborted();
    await rename(temporary, path);
    options.committed?.();
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return bytesDigest(bytes);
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
