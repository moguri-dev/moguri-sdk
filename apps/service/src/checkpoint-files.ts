import { lstatSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import {
  CHECKPOINT_FILE_BYTES, CHECKPOINT_WORKSPACE_BYTES, MoguriError, type CheckpointBoundary, type CheckpointFile, type CheckpointRoot, type CheckpointWorkspace,
} from "../../../packages/protocol/src/index.ts";
import { sourceRootSync, type SourceRoot } from "./repository-source.ts";
import { bytesDigest, isPrivateContextPath, readRegularFileSync, scopedPathSync } from "./files.ts";
import { ignoredPath, readIgnoreScopeSync, type IgnoreScope } from "./ignore-rules.ts";
import { matchesFolder } from "./project-policy.ts";
import { digest } from "./store.ts";

export interface CheckpointRootInput { binding: SourceRoot; repositoryId: string | null; denied: string[]; home?: boolean }
function gitIdentity(root: string): CheckpointRoot["git"] {
  try { lstatSync(join(root, ".git")); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
  const run = (args: string[], unborn = false) => {
    const result = spawnSync("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--literal-pathspecs", ...args], {
      cwd: root, env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
    });
    if (unborn && result.status === 1) return null;
    if (result.error || result.status !== 0) throw new MoguriError("checkpoint_git", "Exact root HEAD/index inspection failed. No parent repository or partial Git state was substituted.", 409);
    return result.stdout;
  };
  if (run(["rev-parse", "--path-format=absolute", "--show-toplevel"])?.trim() !== root) throw new MoguriError("checkpoint_git", "Checkpoint Git metadata belongs to another root.", 409);
  return { head: run(["rev-parse", "--verify", "--quiet", "HEAD"], true)?.trim() ?? null, indexDigest: digest(run(["ls-files", "--stage", "-z"])!) };
}
export function checkpointWorkspace(inputs: CheckpointRootInput[]): CheckpointWorkspace {
  const roots: CheckpointRoot[] = [];
  let bytes = 0, entries = 0, count = 0;
  for (const input of inputs) {
    const { binding, denied } = input, files: CheckpointFile[] = [], excluded: string[] = [];
    const directories: { path: string; device: bigint; inode: bigint; mtimeNs: bigint; ctimeNs: bigint }[] = [];
    if (JSON.stringify(sourceRootSync(binding.root)) !== JSON.stringify(binding)) throw new MoguriError("checkpoint_root", "The exact checkpoint root was replaced.", 409);
    const walk = (directory: string, inherited: IgnoreScope[], depth: number) => {
      if (depth > 32) throw new MoguriError("checkpoint_limit", "Workspace capture exceeds 32 directory levels. No truncated snapshot was admitted.", 413);
      const metadata = lstatSync(directory, { bigint: true });
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new MoguriError("checkpoint_changed", "A captured directory changed to an unsupported path.", 409);
      directories.push({ path: directory, device: metadata.dev, inode: metadata.ino, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs });
      const chain = [...inherited, readIgnoreScopeSync(binding.root, directory)];
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entries > 10000) throw new MoguriError("checkpoint_limit", "Workspace capture exceeds 10,000 entries. No partial tree was called complete.", 413);
        const absolute = join(directory, entry.name), path = relative(binding.root, absolute);
        if (isPrivateContextPath(path) || (input.home || binding.root === homedir()) && ["Library", ".cache", ".Trash"].includes(path.split("/")[0]!) ||
          matchesFolder(path, denied) || ignoredPath(binding.root, absolute, entry.isDirectory(), chain)) { excluded.push(path); continue; }
        if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new MoguriError("checkpoint_incomplete", `Unsupported linked/special workspace path ${path}. Protected content was not followed.`, 409);
        if (entry.isDirectory()) walk(absolute, chain, depth + 1);
        else {
          if (++count > 2000) throw new MoguriError("checkpoint_limit", "Workspace capture exceeds 2,000 files. No omitted file was treated as absent.", 413);
          const canonical = scopedPathSync(binding.root, path), before = lstatSync(canonical, { bigint: true });
          const content = readRegularFileSync(canonical, CHECKPOINT_FILE_BYTES), after = lstatSync(canonical, { bigint: true });
          if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
            before.size !== after.size || content.length !== Number(after.size)) throw new MoguriError("checkpoint_changed", "A workspace file changed during capture.", 409);
          bytes += content.length;
          if (bytes > CHECKPOINT_WORKSPACE_BYTES) throw new MoguriError("checkpoint_limit", "Workspace capture exceeds 16 MiB. No complete snapshot was fabricated.", 413);
          files.push({ path, digest: bytesDigest(content), bytes: content.length, mode: Number(after.mode & 0o777n), content: content.toString("base64"),
            identity: { device: String(after.dev), inode: String(after.ino), mtimeNs: String(after.mtimeNs), ctimeNs: String(after.ctimeNs) } });
        }
      }
    };
    walk(binding.root, [], 0);
    const git = gitIdentity(binding.root);
    for (const file of files) {
      if (!file.identity) throw new MoguriError("checkpoint_source", "A Local filesystem capture needs its actual file identity, not invented metadata.", 409);
      const current = lstatSync(scopedPathSync(binding.root, file.path), { bigint: true });
      if (String(current.dev) !== file.identity.device || String(current.ino) !== file.identity.inode ||
        String(current.mtimeNs) !== file.identity.mtimeNs || String(current.ctimeNs) !== file.identity.ctimeNs ||
        bytesDigest(readRegularFileSync(join(binding.root, file.path), CHECKPOINT_FILE_BYTES)) !== file.digest) {
        throw new MoguriError("checkpoint_changed", "Workspace bytes changed during the complete-tree verification. No mixed snapshot was retained.", 409);
      }
    }
    for (const directory of directories) {
      const actual = lstatSync(directory.path, { bigint: true });
      if (actual.dev !== directory.device || actual.ino !== directory.inode || actual.mtimeNs !== directory.mtimeNs || actual.ctimeNs !== directory.ctimeNs) {
        throw new MoguriError("checkpoint_changed", "The complete workspace file set changed during capture. No added/deleted path was silently omitted.", 409);
      }
    }
    if (JSON.stringify(sourceRootSync(binding.root)) !== JSON.stringify(binding)) throw new MoguriError("checkpoint_root", "The root changed during capture.", 409);
    if (JSON.stringify(gitIdentity(binding.root)) !== JSON.stringify(git)) throw new MoguriError("checkpoint_changed", "Git HEAD/index changed during complete capture. No mixed Git intent was retained.", 409);
    roots.push({ binding, repositoryId: input.repositoryId, files, excluded, git });
  }
  const value = { version: 1 as const, roots, bytes };
  return { ...value, digest: digest(JSON.stringify(value)) };
}
export const checkpointFileVersion = (file: CheckpointFile | undefined) => file ? JSON.stringify([file.digest, file.bytes, file.mode]) : "absent";
export function checkpointReviewDigest(workspace: CheckpointWorkspace): string {
  let boundary: Omit<CheckpointBoundary, "sourceDigest"> | null = null;
  if (workspace.boundary) { const { sourceDigest: _, ...captured } = workspace.boundary; boundary = captured; }
  return digest(JSON.stringify([boundary, workspace.roots.map((root) => ({
    key: root.key ?? root.binding.root, repositoryId: root.repositoryId,
    binding: workspace.boundary?.env === "Sandbox" ? null : root.binding,
    files: root.files.map(({ path, digest, bytes, mode }) => ({ path, digest, bytes, mode })), excluded: root.excluded, git: root.git,
  }))]));
}
