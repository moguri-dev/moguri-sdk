import { openPromise, type Entry } from "yauzl";
import { crc32 } from "node:zlib";
import { lstat, mkdir, open, symlink } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { bundleTreeSha512, fileSha512, internalBundleLink, MAX_BUNDLE_BYTES, MAX_BUNDLE_ENTRIES, verifyBundleIdentity } from "./bundle-tree.ts";
import type { UpdateManifest } from "../../../packages/protocol/src/application-updates.ts";

export async function stageUpdateArchive(archive: string, destination: string, manifest: UpdateManifest, signal: AbortSignal): Promise<string> {
  const metadata = await lstat(archive);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== manifest.archive.bytes || await fileSha512(archive) !== manifest.archive.sha512) throw new Error("The actual update archive failed its exact size/SHA-512 verification.");
  const zip = await openPromise(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false });
  const entries: { entry: Entry; path: string; mode: number; kind: "file" | "directory" | "symlink"; target?: string }[] = [], names = new Set<string>();
  let expanded = 0;
  try {
    if (zip.entryCount > MAX_BUNDLE_ENTRIES) throw new Error("Update archive exceeds its bounded entry count.");
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      const raw = entry.fileName, path = raw.replace(/\/$/, ""), parts = path.split("/"), mode = entry.externalFileAttributes >>> 16;
      if (!path || path.length > 2048 || /[\\\u0000-\u001f]/.test(path) || posix.isAbsolute(path) || parts.some((part) => !part || part === "." || part === "..")) throw new Error("Update archive contains an invalid or traversing path.");
      const folded = path.normalize("NFC").toLowerCase();
      if (names.has(folded)) throw new Error("Update archive paths collide by case or Unicode normalization.");
      names.add(folded);
      if (entry.isEncrypted() || !entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod) || entry.uncompressedSize > 768 * 1024 * 1024 ||
        (expanded += entry.uncompressedSize) > MAX_BUNDLE_BYTES || entry.uncompressedSize > 65536 && entry.uncompressedSize > Math.max(1, entry.compressedSize) * 1000) throw new Error("Update archive encryption, compression or expansion exceeds supported bounds.");
      const type = mode & 0o170000, kind = type === 0o120000 ? "symlink" : raw.endsWith("/") || type === 0o040000 ? "directory" : "file";
      if (![0, 0o100000, 0o040000, 0o120000].includes(type)) throw new Error("Update archive contains a special file type.");
      if (parts[0] === "__MACOSX") continue;
      if (kind !== "symlink" && mode & 0o7022) throw new Error("Update archive contains a set-ID or unsafe writable application entry.");
      if (parts[0] !== "Moguri.app" || parts.length === 1 && kind !== "directory") throw new Error("Update archive must contain only the expected Moguri application path.");
      const relative = parts.slice(1).join("/");
      let target: string | undefined;
      if (kind === "symlink") {
        if (entry.uncompressedSize > 4096) throw new Error("A bundle link exceeds its path bound.");
        const stream = await zip.openReadStreamPromise(entry), chunks: Buffer[] = []; let bytes = 0;
        for await (const value of stream) { const buffer = Buffer.from(value); bytes += buffer.length; if (bytes > 4096) throw new Error("A bundle link exceeded its declared path bound."); chunks.push(buffer); }
        const data = Buffer.concat(chunks);
        if (bytes !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw new Error("A bundle link failed exact size/CRC validation.");
        target = data.toString("utf8"); internalBundleLink(relative, target);
      }
      entries.push({ entry, path: relative, kind, mode: mode & 0o777 || (kind === "directory" ? 0o755 : 0o644), ...(target !== undefined ? { target } : {}) });
    }
    const links = new Set(entries.filter((entry) => entry.kind === "symlink").map((entry) => entry.path.toLowerCase()));
    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let count = 1; count < parts.length; count++) if (links.has(parts.slice(0, count).join("/").toLowerCase())) throw new Error("An archive entry has a symbolic-link parent.");
    }
    await mkdir(destination, { mode: 0o700 });
    const root = join(destination, "Moguri.app"); await mkdir(root, { mode: 0o755 });
    for (const value of entries.filter((entry) => entry.kind !== "symlink")) {
      signal.throwIfAborted();
      const path = join(root, value.path);
      if (value.kind === "directory") { await mkdir(path, { recursive: true, mode: value.mode }); continue; }
      await mkdir(dirname(path), { recursive: true, mode: 0o755 });
      const file = await open(path, "wx", value.mode);
      let bytes = 0, checksum = 0;
      try {
        const stream = await zip.openReadStreamPromise(value.entry);
        try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          const buffer = Buffer.from(chunk); bytes += buffer.length;
          if (bytes > value.entry.uncompressedSize) throw new Error("An update file exceeded its exact declared size.");
          checksum = crc32(buffer, checksum); await file.writeFile(buffer);
        }
        if (bytes !== value.entry.uncompressedSize || checksum !== value.entry.crc32) throw new Error("An update file failed its exact size/CRC check.");
        await file.sync();
        } finally { stream.destroy(); }
      } finally { await file.close(); }
    }
    for (const value of entries.filter((entry) => entry.kind === "symlink")) {
      signal.throwIfAborted(); const path = join(root, value.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o755 }); await symlink(value.target!, path);
    }
    if (await bundleTreeSha512(root, signal) !== manifest.bundleSha512) throw new Error("The actual application tree does not match the release bundle digest.");
    await verifyBundleIdentity(root, manifest.version, manifest.arch);
    return root;
  } finally { zip.close(); }
}
