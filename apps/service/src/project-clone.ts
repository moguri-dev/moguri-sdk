import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { MoguriError, type Project, type ProjectCloneIntent } from "../../../packages/protocol/src/index.ts";
import { runProgram } from "./program.ts";

export const localRootsOverlap = (left: string, right: string): boolean => isAbsolute(left) && isAbsolute(right) &&
  (left === right || left.startsWith(right.endsWith(sep) ? right : `${right}${sep}`) || right.startsWith(left.endsWith(sep) ? left : `${left}${sep}`));

function repositoryUrl(input: string): string {
  if (input !== input.trim() || /[\s\0-\x1f\x7f]/.test(input) || input.startsWith("-")) throw new MoguriError("clone_repository", "Use an explicit HTTPS or SSH repository URL without credentials or control characters.");
  const scp = input.match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,63})@([A-Za-z0-9][A-Za-z0-9.-]*):([^/].+)$/);
  let url: URL;
  try { url = new URL(scp ? `ssh://${scp[1]}@${scp[2]}/${scp[3]}` : input); }
  catch { throw new MoguriError("clone_repository", "Use an explicit HTTPS or SSH repository URL, such as https://github.com/owner/repository.git."); }
  if (!["https:", "ssh:"].includes(url.protocol) && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) ||
    url.password || url.protocol !== "ssh:" && url.username || url.search || url.hash || url.pathname === "/" || !url.pathname ||
    url.hostname.startsWith("-") || url.protocol === "ssh:" && url.username && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(url.username) ||
    /%(?:00|0a|0d)/i.test(url.pathname)) throw new MoguriError("clone_repository", "Choose a credential-free HTTPS/SSH repository URL. Custom/local transports, query credentials and submodule initialization are not supported.");
  return scp ? input : url.href;
}

export async function prepareProjectClone(repository: string, path: string, policyRevision: number, identity: { id: string; digest: string }): Promise<ProjectCloneIntent> {
  const source = repositoryUrl(repository);
  if (!isAbsolute(path) || resolve(path) !== path || !basename(path) || /[\0\r\n]/.test(path)) throw new MoguriError("clone_destination", "Choose an explicit new absolute destination inside an existing folder.");
  const parent = await realpath(dirname(path)), metadata = await lstat(parent, { bigint: true }), destination = join(parent, basename(path));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new MoguriError("clone_destination", "The chosen clone parent is not a canonical directory.");
  try { await lstat(destination); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {
      version: 1, projectId: randomUUID(), repository: source, path: destination, parent,
      device: String(metadata.dev), inode: String(metadata.ino), leaseRoots: [destination], policyRevision, commandId: identity.id, commandDigest: identity.digest,
    };
    throw error;
  }
  throw new MoguriError("clone_destination_exists", "The clone destination already exists. Choose a new folder; existing files are never overwritten or removed.", 409);
}

export async function assertCloneParent(intent: ProjectCloneIntent): Promise<void> {
  const current = await lstat(intent.parent, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink() || await realpath(intent.parent) !== intent.parent ||
    String(current.dev) !== intent.device || String(current.ino) !== intent.inode) throw new MoguriError("clone_root_changed", "The captured clone parent changed. No different root was selected.", 409);
}

export async function cloneProject(intent: ProjectCloneIntent, signal: AbortSignal, progress: (text: string) => void, recheck: () => void, created: () => void): Promise<Project> {
  signal.throwIfAborted(); recheck(); await assertCloneParent(intent); signal.throwIfAborted(); recheck();
  await mkdir(intent.path, { mode: 0o700 }); created();
  const directory = await lstat(intent.path, { bigint: true });
  const assertRoot = async () => {
    signal.throwIfAborted(); recheck(); await assertCloneParent(intent);
    const current = await lstat(intent.path, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || await realpath(intent.path) !== intent.path ||
      current.dev !== directory.dev || current.ino !== directory.ino) throw new MoguriError("clone_root_changed", "The owned clone directory changed. Original effects were retained, never moved or replayed.", 409);
  };
  await assertRoot(); progress(`Cloning into ${intent.path}. Cancel preserves partial files; no hooks, filters or submodules run.`);
  await runProgram("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
    "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", "clone", "--no-recurse-submodules", "--no-hardlinks", "--template=", "--", intent.repository, intent.path], {
    cwd: intent.parent, signal, label: "Repository clone", timeoutMs: 300_000, maxBytes: 512 * 1024,
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false",
      GIT_SSH_COMMAND: "ssh -F /dev/null -oBatchMode=yes -oStrictHostKeyChecking=yes -oForwardAgent=no -oClearAllForwardings=yes -oConnectTimeout=20",
      SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, GIT_EXEC_PATH: process.env.GIT_EXEC_PATH },
  });
  await assertRoot();
  const git = await lstat(join(intent.path, ".git"));
  if (!git.isDirectory() || git.isSymbolicLink()) throw new MoguriError("clone_repository", "The clone did not produce its own regular Git directory. No project was registered.", 409);
  return { id: intent.projectId, name: basename(intent.path), path: intent.path };
}
