import { MoguriError, type SessionWorkspaceResponse } from "../../../packages/protocol/src/index.ts";
import { realpath } from "node:fs/promises";
import { isProtectedProjectPath } from "./files.ts";
import { assertFolderName, validateProjectPath } from "./project-policy.ts";
import { runProgram } from "./program.ts";

const git = (root: string, args: string[], signal: AbortSignal, filters: string[] = []) => runProgram("git", [
  "--no-pager", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false",
  ...filters, "--literal-pathspecs", ...args,
], {
  cwd: root, signal, label: "Read workspace Git state", timeoutMs: 30_000, maxBytes: 512 * 1024,
  env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
});

export async function gitReadFilters(root: string, signal: AbortSignal): Promise<string[]> {
  const config = await git(root, ["config", "--null", "--list"], signal), drivers = new Set<string>();
  for (const entry of config.split("\0")) {
    const key = entry.split("\n", 1)[0]!;
    if (!key.startsWith("filter.")) continue;
    const match = key.match(/^filter\.([A-Za-z0-9_.-]+)\.(?:smudge|clean|process|required)$/);
    if (!match) throw new MoguriError("workspace_filter", "This repository has a filter name Moguri cannot safely suppress. No hook/filter was executed.");
    drivers.add(match[1]!);
  }
  return [...drivers].flatMap((driver) => ["-c", `filter.${driver}.smudge=`, "-c", `filter.${driver}.clean=`, "-c", `filter.${driver}.process=`, "-c", `filter.${driver}.required=false`]);
}
export async function readGit(root: string, args: string[], signal: AbortSignal): Promise<string> {
  return git(root, args, signal, await gitReadFilters(root, signal));
}

export async function readGitBinding(root: string, signal: AbortSignal): Promise<{ gitCommonDir: string; head: string; branch: string }> {
  const filters = await gitReadFilters(root, signal), read = (args: string[]) => git(root, args, signal, filters);
  const top = (await read(["rev-parse", "--path-format=absolute", "--show-toplevel"])).replace(/\n$/, "");
  if (await realpath(top) !== root) throw new MoguriError("workspace_git_root", "Git's working tree does not match this exact canonical candidate root.", 409);
  const gitCommonDir = await realpath((await read(["rev-parse", "--path-format=absolute", "--git-common-dir"])).replace(/\n$/, ""));
  const head = (await read(["rev-parse", "--verify", "HEAD"])).trim(), branch = (await read(["branch", "--show-current"])).trim() || "(detached)";
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw new MoguriError("workspace_git_base", "Git returned no exact committed candidate base.", 409);
  return { gitCommonDir, head, branch };
}
export async function optionalGitBinding(root: string, signal: AbortSignal) {
  try { return await readGitBinding(root, signal); }
  catch (error) {
    if (error instanceof MoguriError && (error.code === "workspace_git_root" || error.code === "program_failed" && /not a git repository/i.test(error.message))) return null;
    throw error;
  }
}
export async function candidateGitState(root: string, signal: AbortSignal): Promise<string> {
  const filters = await gitReadFilters(root, signal), read = (args: string[]) => git(root, args, signal, filters);
  const [status, worktree, index] = await Promise.all([
    read(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    read(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--"]),
    read(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--"]),
  ]);
  return JSON.stringify({ status, worktree, index });
}

export async function readWorkspaceGit(root: string, policy: { upstream: string; deniedFolders: string[] }, includeDiff: boolean, signal: AbortSignal, checkoutFilters?: string[]): Promise<Extract<SessionWorkspaceResponse, { type: "project.git" }>> {
  const filters = checkoutFilters ?? await gitReadFilters(root, signal), read = (args: string[]) => git(root, args, signal, filters);
  const top = (await read(["rev-parse", "--path-format=absolute", "--show-toplevel"])).replace(/\n$/, "");
  if (await realpath(top) !== await realpath(root)) throw new MoguriError("workspace_git_root", "Git's working tree does not match the approved workspace. No status or diff was read from another root.", 409);
  const branch = (await read(["branch", "--show-current"])).trim() || "(detached)";
  const raw = await read(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]), entries = raw.split("\0").filter(Boolean);
  const allowed: { name: string; code: string }[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!, code = entry.slice(0, 2), name = entry.slice(3);
    if (code.includes("R") || code.includes("C")) index++;
    try {
      validateProjectPath(name);
      if (isProtectedProjectPath(name)) continue;
      assertFolderName(name, false, { denied: policy.deniedFolders, readOnly: [] });
      allowed.push({ name, code });
    } catch (error) {
      if (!(error instanceof MoguriError && ["path_denied", "folder_denied"].includes(error.code))) throw error;
    }
  }
  let repository: string | null = null;
  const origin = (await read(["remote", "-v"])).split("\n").find((line) => line.startsWith(`${policy.upstream}\t`))?.split(/\s+/)[1];
  if (origin) {
    const match = origin.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
    if (match) repository = `https://github.com/${match[1]}`;
  }
  const tracked = allowed.filter((entry) => entry.code !== "??").map((entry) => entry.name);
  const diff = includeDiff && tracked.length ? await read(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD", "--", ...tracked]) : "";
  return { type: "project.git", branch, repository, status: allowed.map((entry) => `${entry.code} ${entry.name}`).join("\n"), diff };
}
