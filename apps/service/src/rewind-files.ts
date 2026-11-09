import { mkdir, lstat, open, rename, link, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { MoguriError, type CheckpointFile } from "../../../packages/protocol/src/index.ts";
import { bytesDigest, readRegularFileSync, scopedPathSync } from "./files.ts";

async function privateDirectory(root: string, operationId: string, check: () => void): Promise<string> {
  let directory = root;
  for (const part of [".moguri", "rewinds", operationId]) {
    check(); directory = join(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077) throw new MoguriError("rewind_backup", "The reviewed backup parent is not a private owned regular directory. No source was moved.", 409);
  }
  check(); return directory;
}
export async function publishRewindFile(root: string, operationId: string, index: number, path: string, current: CheckpointFile | undefined,
  target: CheckpointFile | undefined, check: () => void): Promise<string | null> {
  check();
  const directory = await privateDirectory(root, operationId, check), backup = current ? join(directory, `${index}.displaced`) : null;
  const temporary = join(directory, `${index}.next`), destination = scopedPathSync(root, path, true);
  const parts = relative(root, dirname(destination)).split("/").filter(Boolean);
  let parent = root;
  for (const part of parts) {
    check(); parent = join(parent, part);
    await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MoguriError("rewind_path", "The reviewed destination parent changed to a link or non-directory.", 409);
  }
  try {
    if (target) {
      const bytes = Buffer.from(target.content, "base64");
      if (bytes.length !== target.bytes || bytesDigest(bytes) !== target.digest) throw new MoguriError("rewind_source", "The retained target bytes failed their exact digest.", 409);
      const file = await open(temporary, "wx", target.mode);
      try { await file.writeFile(bytes); await file.chmod(target.mode); await file.sync(); } finally { await file.close(); }
    }
    check(); scopedPathSync(root, path, !current);
    if (current) {
      const bytes = readRegularFileSync(destination, current.bytes);
      if (bytesDigest(bytes) !== current.digest) throw new MoguriError("rewind_conflict", "External bytes changed after review. No unreviewed content was replaced.", 409);
      await rename(destination, backup!);
      const moved = readRegularFileSync(backup!, current.bytes);
      if (bytesDigest(moved) !== current.digest) throw new MoguriError("rewind_conflict", "A concurrent writer changed the displaced file. Its actual inode/bytes remain in the private backup; no replacement was published.", 409);
      const backupParent = await open(directory, "r");
      try { await backupParent.sync(); } finally { await backupParent.close(); }
    }
    check();
    if (target) {
      await link(temporary, destination);
      if (bytesDigest(readRegularFileSync(scopedPathSync(root, path), target.bytes)) !== target.digest) throw new MoguriError("rewind_conflict", "A concurrent writer changed the newly published file. All displaced data was preserved; complete restoration was not claimed.", 409);
    } else {
      try { await lstat(destination); throw new MoguriError("rewind_conflict", "An external writer recreated this path. Its new content was preserved.", 409); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
    const destinationParent = await open(dirname(destination), "r");
    try { await destinationParent.sync(); } finally { await destinationParent.close(); }
    check(); return backup;
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
