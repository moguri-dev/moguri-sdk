import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriError, type RepositoryRemoteReview } from "../../../packages/protocol/src/index.ts";
import { readGitBinding } from "./project-git.ts";
import { repositoryIdentity, repositoryUrl } from "./project-clone.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";
import { digest } from "./store.ts";
import { runProgram } from "./program.ts";

type Git = (root: string, args: string[], signal: AbortSignal) => Promise<string>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const entries = (text: string) => text.split("\0").filter(Boolean).map((entry) => {
  const split = entry.indexOf("\n");
  return { key: split < 0 ? entry : entry.slice(0, split), value: split < 0 ? "" : entry.slice(split + 1) };
});
async function configFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size > 1024n * 1024n) throw new MoguriError("remote_config", "The shared Git config must be a bounded regular file, never a symlink or alternate write target.", 409);
    const bytes = await file.readFile();
    if (Buffer.compare(bytes, Buffer.from(bytes.toString("utf8"))) !== 0) throw new MoguriError("remote_config", "The shared Git config is not lossless UTF-8. No config was rewritten.", 409);
    return { bytes, path, device: String(metadata.dev), inode: String(metadata.ino), mode: Number(metadata.mode & 0o777n), digest: hash(bytes) };
  } finally { await file.close(); }
}
export async function inspectRemoteChange(root: string, name: string, input: string, directory: string, signal: AbortSignal,
  git: Git, validateOldUrl: (url: string) => string, run: typeof runProgram = runProgram): Promise<RepositoryRemoteReview> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name)) throw new MoguriError("remote_name", "Select one exact configured Git remote.", 409);
  const url = repositoryUrl(input), binding = await readGitBinding(root, signal), common = await sourceRoot(binding.gitCommonDir);
  const config = await configFile(join(common.root, "config"));
  const raw = entries(await git(root, ["config", "--file", config.path, "--no-includes", "--null", "--list"], signal));
  const fetch = raw.filter((entry) => entry.key === `remote.${name}.url`), push = raw.filter((entry) => entry.key === `remote.${name}.pushurl`);
  if (fetch.length !== 1 || push.length > 1) throw new MoguriError("remote_config", "Remote changes require one shared fetch URL and at most one explicit push URL. Included, missing or multi-destination remotes need a separate explicit Git review.", 409);
  const fetchUrl = validateOldUrl(fetch[0]!.value), pushUrls = push.map((entry) => validateOldUrl(entry.value));
  if (fetchUrl === url && pushUrls.every((entry) => entry === url)) throw new MoguriError("remote_unchanged", "This remote already has the requested URL. No config was changed.", 409);
  const inventory = (await git(root, ["worktree", "list", "--porcelain", "-z"], signal)).split("\0").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
  if (!inventory.length || inventory.length > 1000 || new Set(inventory).size !== inventory.length) throw new MoguriError("remote_worktrees", "Git did not return one complete bounded linked-worktree boundary. No root was guessed.", 409);
  const worktrees: RepositoryRemoteReview["worktrees"] = [];
  for (const path of inventory.sort()) {
    signal.throwIfAborted();
    const identity = await sourceRoot(path), actual = await readGitBinding(path, signal);
    if (actual.gitCommonDir !== common.root) throw new MoguriError("remote_worktrees", "A linked worktree no longer shares the exact reviewed common Git directory.", 409);
    const effectiveText = await git(path, ["config", "--null", "--list"], signal), effective = entries(effectiveText);
    const effectiveFetch = effective.filter((entry) => entry.key === `remote.${name}.url`).map((entry) => entry.value);
    const effectivePush = effective.filter((entry) => entry.key === `remote.${name}.pushurl`).map((entry) => entry.value);
    if (!same(effectiveFetch, [fetchUrl]) || !same(effectivePush, pushUrls)) {
      throw new MoguriError("remote_override", "An included/worktree-specific remote changes this destination. Review that actual config explicitly; Moguri will not silently edit or substitute it.", 409);
    }
    const actualFetch = (await git(path, ["remote", "get-url", "--all", name], signal)).trim().split("\n");
    const actualPush = (await git(path, ["remote", "get-url", "--push", "--all", name], signal)).trim().split("\n");
    const config = ["-c", `remote.${name}.url=${url}`, ...(pushUrls.length ? ["-c", `remote.${name}.pushurl=${url}`] : [])];
    const nextFetch = (await git(path, [...config, "remote", "get-url", "--all", name], signal)).trim().split("\n");
    const nextPush = (await git(path, [...config, "remote", "get-url", "--push", "--all", name], signal)).trim().split("\n");
    if (actualFetch.length !== 1 || actualPush.length !== 1 || nextFetch.length !== 2 || nextPush.length !== 2 ||
      nextFetch[0] !== actualFetch[0] || nextPush[0] !== actualPush[0]) throw new MoguriError("remote_override", "The exact Git URL expansion is ambiguous. No new URL was applied.", 409);
    for (const [actual, expected] of [[actualFetch[0]!, fetchUrl], [actualPush[0]!, pushUrls[0] ?? fetchUrl], [nextFetch[1]!, url], [nextPush[1]!, url]]) {
      validateOldUrl(actual!);
      if (actual !== expected && repositoryIdentity(actual!) !== repositoryIdentity(expected!)) throw new MoguriError("remote_override", "A URL rewrite selects a different repository, host or unsupported transport. Use an explicit current URL; no account or repository was substituted.", 409);
    }
    worktrees.push({ ...identity, configDigest: digest(effectiveText), fetchUrl: actualFetch[0]!, pushUrl: actualPush[0]!, nextFetchUrl: nextFetch[1]!, nextPushUrl: nextPush[1]! });
  }
  if (!worktrees.some((worktree) => worktree.root === root)) throw new MoguriError("remote_worktrees", "The requested root is not an actual member of this shared Git configuration.", 409);
  const temporary = await mkdtemp(join(directory, "remote-review-"));
  try {
    const prepared = await prepareConfig(config.bytes, name, url, pushUrls.length > 0, temporary, signal, run);
    const unrelatedDigest = digest(JSON.stringify(raw.filter((entry) => ![`remote.${name}.url`, `remote.${name}.pushurl`].includes(entry.key))));
    if (prepared.unrelatedDigest !== unrelatedDigest) throw new MoguriError("remote_config", "Preparing the selected URL would alter unrelated Git config. No change was admitted.", 409);
    const fresh = await configFile(config.path);
    if (fresh.digest !== config.digest || fresh.device !== config.device || fresh.inode !== config.inode || !same(sourceRootSync(common.root), common)) throw new MoguriError("remote_stale", "The shared config changed during review. Preview again.", 409);
    return { version: 1, name, url, common, config: { path: config.path, device: config.device, inode: config.inode, mode: config.mode,
      digest: config.digest, replacementDigest: hash(prepared.bytes), unrelatedDigest }, fetchUrl, pushUrls, worktrees };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
async function prepareConfig(bytes: Buffer, name: string, url: string, push: boolean, directory: string, signal: AbortSignal, run: typeof runProgram) {
  const path = join(directory, "config");
  await writeFile(path, bytes, { mode: 0o600, signal });
  const git = (args: string[]) => run("git", ["--no-pager", "config", "--file", path, "--no-includes", ...args], {
    cwd: directory, signal, label: "Prepare exact remote URL", timeoutMs: 10_000, maxBytes: 512 * 1024,
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  await git(["--replace-all", `remote.${name}.url`, url]);
  if (push) await git(["--replace-all", `remote.${name}.pushurl`, url]);
  const prepared = await readFile(path), values = entries(await git(["--null", "--list"]));
  return { bytes: prepared, unrelatedDigest: digest(JSON.stringify(values.filter((entry) => ![`remote.${name}.url`, `remote.${name}.pushurl`].includes(entry.key)))) };
}
export async function applyRemoteChange(review: RepositoryRemoteReview, directory: string, signal: AbortSignal, guard: () => void,
  acknowledged: () => void, run: typeof runProgram = runProgram): Promise<void> {
  signal.throwIfAborted(); guard();
  const temporary = await mkdtemp(join(directory, "remote-publish-")), lockPath = `${review.config.path}.lock`;
  let ownedLock: { device: string; inode: string } | undefined, published = false;
  try {
    const before = await configFile(review.config.path);
    if (before.digest !== review.config.digest || before.device !== review.config.device || before.inode !== review.config.inode ||
      before.mode !== review.config.mode || !same(sourceRootSync(review.common.root), review.common)) throw new MoguriError("remote_stale", "The exact shared Git config/root changed. No URL was written.", 409);
    const prepared = await prepareConfig(before.bytes, review.name, review.url, review.pushUrls.length > 0, temporary, signal, run);
    if (hash(prepared.bytes) !== review.config.replacementDigest || prepared.unrelatedDigest !== review.config.unrelatedDigest) throw new MoguriError("remote_stale", "The exact reviewed replacement no longer matches. No URL was written.", 409);
    const lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, review.config.mode).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new MoguriError("remote_lock", "The shared Git config already has a lock. Its original owner was not adopted and the lock was not deleted; inspect it before a new review.", 409);
      throw error;
    });
    try {
      const metadata = await lock.stat({ bigint: true }); ownedLock = { device: String(metadata.dev), inode: String(metadata.ino) };
      await lock.chmod(review.config.mode);
      signal.throwIfAborted(); guard();
      const current = await configFile(review.config.path);
      if (current.digest !== before.digest || current.device !== before.device || current.inode !== before.inode) throw new MoguriError("remote_stale", "The shared config changed before its lock was acquired. No replacement was published.", 409);
      await lock.writeFile(prepared.bytes); await lock.sync();
    } finally { await lock.close(); }
    signal.throwIfAborted(); guard();
    const final = await configFile(review.config.path);
    if (final.digest !== review.config.digest || final.device !== review.config.device || final.inode !== review.config.inode) throw new MoguriError("remote_stale", "The exact config revision changed before atomic publication. No overwrite was attempted.", 409);
    const preparedLock = await configFile(lockPath);
    if (!ownedLock || preparedLock.device !== ownedLock.device || preparedLock.inode !== ownedLock.inode || preparedLock.digest !== review.config.replacementDigest) {
      ownedLock = undefined;
      throw new MoguriError("remote_lock_changed", "The prepared config lock changed ownership or bytes. It was preserved for inspection, not published or deleted.", 409);
    }
    await rename(lockPath, review.config.path); published = true; acknowledged();
    const parent = await open(review.common.root, constants.O_RDONLY);
    try { await parent.sync(); } finally { await parent.close(); }
    signal.throwIfAborted(); guard();
    if ((await configFile(review.config.path)).digest !== review.config.replacementDigest) throw new MoguriError("remote_partial", "The published config no longer matches the original reviewed bytes. Inspect it; no retry or rollback.", 409);
  } finally {
    try {
      if (ownedLock && !published) {
        let current;
        try { current = await lstat(lockPath, { bigint: true }); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        if (current) {
          if (current.isSymbolicLink() || String(current.dev) !== ownedLock.device || String(current.ino) !== ownedLock.inode) throw new MoguriError("remote_cleanup", "The config lock's owner changed. The lock was preserved for inspection, not deleted.", 409);
          await rm(lockPath);
        }
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
