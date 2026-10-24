import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_BUNDLE_ENTRIES = 100_000;
export async function fileSha512(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash("sha512");
  try {
    const before = await file.stat(), buffer = Buffer.alloc(64 * 1024); let offset = 0;
    if (!before.isFile()) throw new Error("Bundle hashing requires a regular no-follow file.");
    while (true) { const read = await file.read(buffer, 0, buffer.length, offset); if (!read.bytesRead) break; hash.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead; }
    const after = await file.stat();
    if (before.size !== offset || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Bundle bytes changed while hashing. No update was accepted.");
    return hash.digest("hex");
  } finally { await file.close(); }
}
export function internalBundleLink(path: string, target: string): string {
  if (!target || target.length > 4096 || /[\\\u0000-\u001f]/.test(target) || posix.isAbsolute(target)) throw new Error("Bundle links must be bounded relative internal paths.");
  const result = posix.normalize(posix.join(posix.dirname(path), target));
  if (result === ".." || result.startsWith("../") || result.startsWith("/")) throw new Error("Bundle link escapes its application root.");
  return result;
}
export async function bundleTreeSha512(root: string, signal?: AbortSignal): Promise<string> {
  const canonical = await realpath(root), entries: unknown[] = [], paths = new Set<string>();
  let bytes = 0;
  const walk = async (relative: string): Promise<void> => {
    signal?.throwIfAborted();
    const path = join(root, relative), metadata = await lstat(path), name = relative.split(sep).join("/").normalize("NFC");
    if (name) {
      const folded = name.toLowerCase();
      if (paths.has(folded) || paths.size >= MAX_BUNDLE_ENTRIES) throw new Error("Bundle paths collide or exceed the bounded inventory.");
      paths.add(folded);
    }
    if (metadata.isSymbolicLink()) {
      const target = await readlink(path); internalBundleLink(name, target);
      const actual = await realpath(path);
      if (actual !== canonical && !actual.startsWith(canonical + sep)) throw new Error("Bundle symlink escapes, cycles or refers to missing application bytes.");
      entries.push({ path: name, type: "symlink", target }); return;
    }
    if (!metadata.isDirectory() && !metadata.isFile() || metadata.mode & 0o7022) throw new Error("Bundle contains a special or unsafe writable/set-ID entry.");
    const mode = metadata.mode & 0o777;
    if (metadata.isFile()) {
      if ((bytes += metadata.size) > MAX_BUNDLE_BYTES) throw new Error("Bundle exceeds four GiB.");
      entries.push({ path: name, type: "file", mode, bytes: metadata.size, sha512: await fileSha512(path) }); return;
    }
    if (name) entries.push({ path: name, type: "directory", mode });
    for (const child of (await readdir(path)).sort()) await walk(relative ? join(relative, child) : child);
  };
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("The application root must be an actual directory, not a link.");
  await walk("");
  return createHash("sha512").update(JSON.stringify(entries)).digest("hex");
}
export async function verifyBundleIdentity(root: string, version: string, arch: "arm64" | "x64"): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Application replacement is qualified only on macOS.");
  const info = join(root, "Contents", "Info.plist");
  const value = async (key: string) => (await promisify(execFile)("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", info], { timeout: 5000, maxBuffer: 64 * 1024 })).stdout.trim();
  if (await value("CFBundleIdentifier") !== "dev.moguri.app" || await value("CFBundleExecutable") !== "Moguri") throw new Error("The staged bundle has a foreign application identity.");
  const packagePath = join(root, "Contents", "Resources", "app", "package.json"), metadata = await lstat(packagePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("The bundle package identity is not a bounded regular file.");
  const json: unknown = JSON.parse(await readFile(packagePath, "utf8"));
  if (!json || typeof json !== "object" || !("name" in json) || json.name !== "moguri" || !("version" in json) || json.version !== version || !("main" in json) || json.main !== "dist/desktop/main.mjs") throw new Error("The package does not match the exact reviewed Moguri version/entrypoint.");
  for (const path of ["dist/desktop/main.mjs", "dist/service.mjs", "dist/update-installer.mjs", "node_modules/node/bin/node"]) {
    const file = await lstat(join(root, "Contents", "Resources", "app", path));
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("The staged application is missing an actual required runtime file.");
  }
  const executable = await open(join(root, "Contents", "MacOS", "Moguri"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(4096), result = await executable.read(bytes, 0, bytes.length, 0), expected = arch === "arm64" ? 0x0100000c : 0x01000007;
    if (result.bytesRead < 12) throw new Error("The application executable has no Mach-O architecture.");
    const little = bytes.readUInt32LE(0) === 0xfeedfacf || bytes.readUInt32LE(0) === 0xfeedface;
    const big = bytes.readUInt32BE(0) === 0xfeedfacf || bytes.readUInt32BE(0) === 0xfeedface;
    let matches = little ? bytes.readUInt32LE(4) === expected : big ? bytes.readUInt32BE(4) === expected : false;
    if (bytes.readUInt32BE(0) === 0xcafebabe || bytes.readUInt32BE(0) === 0xcafebabf) {
      const count = bytes.readUInt32BE(4), stride = bytes.readUInt32BE(0) === 0xcafebabf ? 32 : 20;
      if (count > 32 || 8 + count * stride > result.bytesRead) throw new Error("The universal executable architecture table is invalid.");
      for (let index = 0; index < count; index++) if (bytes.readUInt32BE(8 + index * stride) === expected) matches = true;
    }
    if (!matches) throw new Error("The actual application architecture does not match the reviewed release.");
  } finally { await executable.close(); }
}
export async function pinnedInstalledApplication(version: string): Promise<string | undefined> {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) return undefined;
  const runtime = await realpath(process.execPath), suffix = "/Contents/Resources/app/node_modules/node/bin/node";
  if (!runtime.endsWith(suffix)) return undefined;
  const root = runtime.slice(0, -suffix.length);
  if (!root.endsWith("/Moguri.app")) return undefined;
  await verifyBundleIdentity(root, version, process.arch === "arm64" ? "arm64" : "x64");
  return root;
}
export async function verifyStandaloneInstallerRuntime(path: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The captured installer runtime is qualified only on macOS.");
  const result = await promisify(execFile)("/usr/bin/otool", ["-L", path], { timeout: 5000, maxBuffer: 64 * 1024 });
  const dependencies = result.stdout.split("\n").slice(1).map((line) => line.trim().split(" (")[0]!).filter(Boolean);
  if (!dependencies.length || dependencies.some((path) => !path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"))) throw new Error("The captured installer Node depends on non-system dylibs. Use Moguri's pinned standalone bundled Node; no library was borrowed from a renamed/new bundle.");
}
