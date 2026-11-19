import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const supported = process.platform === "darwin" && process.arch === "arm64";

// A generated checkout whose origin keeps its real production form, served by an SSH shim from a local bare repository.
async function generatedRelease() {
  const root = await mkdtemp(join(tmpdir(), "moguri-release-script-")), bare = join(root, "origin.git"), work = join(root, "work"), bin = join(root, "bin");
  const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, env });
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH}`, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), TMPDIR: join(root, "tmp"),
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_VARIANT: "ssh", GIT_SSH_COMMAND: join(bin, "ssh-shim"),
    FAKE_BARE: bare, FAKE_GH_LOG: join(root, "gh.log"), FAKE_GH_RELEASES: join(root, "releases.json"), FAKE_GH_PRS: join(root, "prs.tsv"),
  };
  for (const directory of [bin, env.HOME!, env.XDG_CONFIG_HOME!, env.TMPDIR!, work]) await mkdir(directory, { recursive: true });
  await writeFile(env.GIT_CONFIG_GLOBAL!, "[user]\n\tname = Generated Maintainer\n\temail = generated@example.invalid\n[init]\n\tdefaultBranch = main\n");
  await writeFile(join(bin, "ssh-shim"), `#!/bin/bash
cmd="\${@: -1}"
case "$cmd" in
  "git-upload-pack 'mbianchidev/moguri.git'") exec git upload-pack "$FAKE_BARE" ;;
  "git-receive-pack 'mbianchidev/moguri.git'") exec git receive-pack "$FAKE_BARE" ;;
  *) echo "unexpected ssh command: $cmd" >&2; exit 1 ;;
esac
`);
  // Answers only the read-only queries a dry run needs; anything else is logged and fails.
  await writeFile(join(bin, "gh"), `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
case "$*" in
  "auth status --hostname github.com") exit 0 ;;
  "api --paginate --slurp repos/mbianchidev/moguri/releases?per_page=100") if [ -f "$FAKE_GH_RELEASES" ]; then cat "$FAKE_GH_RELEASES"; else echo '[[]]'; fi ;;
  "pr list "*) if [ -f "$FAKE_GH_PRS" ]; then cat "$FAKE_GH_PRS"; fi ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 99 ;;
esac
`);
  await writeFile(join(bin, "container"), "#!/bin/bash\nexit 0\n");
  for (const name of ["ssh-shim", "gh", "container"]) await chmod(join(bin, name), 0o755);

  await run("git", ["init", "--quiet", "--bare", bare], { env });
  await git(root, "init", "--quiet", work);
  await mkdir(join(work, "scripts"), { recursive: true });
  await cp(resolve("scripts/release.sh"), join(work, "scripts/release.sh"));
  await cp(resolve("scripts/release"), join(work, "scripts/release"), { recursive: true });
  await symlink(resolve("node_modules"), join(work, "node_modules"));
  await writeFile(join(work, ".gitignore"), "node_modules\n");
  await writeFile(join(work, "package.json"), `${JSON.stringify({ name: "moguri", version: "0.32.0-alpha.1", private: true }, null, 2)}\n`);
  await writeFile(join(work, "package-lock.json"), `${JSON.stringify({ name: "moguri", version: "0.32.0-alpha.1", lockfileVersion: 3, requires: true,
    packages: { "": { name: "moguri", version: "0.32.0-alpha.1" } } }, null, 2)}\n`);
  await git(work, "add", ".");
  await git(work, "commit", "--quiet", "--no-gpg-sign", "-m", "generated base");
  await git(work, "remote", "add", "origin", "git@github.com:mbianchidev/moguri.git");
  await git(work, "push", "--quiet", "origin", "HEAD:refs/heads/main");

  const release = async (...args: string[]) => {
    try {
      const result = await run("/bin/bash", [join(work, "scripts/release.sh"), ...args], { cwd: work, env, timeout: 60_000 });
      return { code: 0, ...result };
    } catch (error) {
      const failed = error as { code: number; stdout: string; stderr: string };
      return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
    }
  };
  const snapshot = async () => ({
    remote: (await git(bare, "for-each-ref")).stdout,
    local: (await git(work, "for-each-ref")).stdout,
    worktrees: (await git(work, "worktree", "list", "--porcelain")).stdout,
    manifest: await readFile(join(work, "package.json"), "utf8"),
    lock: await readFile(join(work, "package-lock.json"), "utf8"),
  });
  const ghCalls = async () => (await readFile(env.FAKE_GH_LOG!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  return { root, bare, work, env, git, release, snapshot, ghCalls };
}

test("a dry run previews a first release without commits, refs, worktrees, journals or GitHub writes", { skip: !supported, timeout: 120_000 }, async () => {
  const fixture = await generatedRelease();
  try {
    const before = await fixture.snapshot();
    const result = await fixture.release("--dry-run", "v0.33.0");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Plan for v0\.33\.0 \(state: fresh\)/);
    assert.match(result.stdout, /No published release yet: v0\.33\.0 will be the first/);
    assert.match(result.stdout, /Dry run: nothing was changed/);
    assert.deepEqual(await fixture.snapshot(), before);
    await assert.rejects(readFile(join(fixture.work, ".git/moguri-release.lock/pid")), { code: "ENOENT" });
    await assert.rejects(readFile(join(fixture.work, ".git/moguri-release/v0.33.0/journal")), { code: "ENOENT" });
    assert.deepEqual((await fixture.ghCalls()).filter((call) => !/^(?:auth status|api --paginate --slurp repos\/mbianchidev\/moguri\/releases|pr list )/.test(call)), []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("dry runs reject invalid, backwards and misrouted releases and warn about skipped versions", { skip: !supported, timeout: 120_000 }, async () => {
  const fixture = await generatedRelease();
  try {
    const invalid = await fixture.release("--dry-run", "1.0");
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /not a SemVer 2\.0\.0 version/);
    const lower = await fixture.release("--dry-run", "0.31.0");
    assert.notEqual(lower.code, 0);
    assert.match(lower.stderr, /must be greater than main's current version 0\.32\.0-alpha\.1/);
    const skipped = await fixture.release("--dry-run", "0.34.0");
    assert.equal(skipped.code, 0, skipped.stderr);
    assert.match(skipped.stderr, /WARNING: 0\.34\.0 skips minor versions after 0\.32\.0-alpha\.1/);
    await writeFile(fixture.env.FAKE_GH_RELEASES!, JSON.stringify([[{ id: 7, tag_name: "v0.33.0", draft: false, prerelease: false, target_commitish: "main", html_url: "https://github.com/mbianchidev/moguri/releases/tag/v0.33.0", assets: [] }]]));
    const backwards = await fixture.release("--dry-run", "0.32.5");
    assert.notEqual(backwards.code, 0);
    assert.match(backwards.stderr, /lower than the latest published release 0\.33\.0/);
    const published = await fixture.release("--dry-run", "0.33.0");
    assert.equal(published.code, 0, published.stderr);
    assert.match(published.stdout, /state: published[\s\S]*Only verify the release/);
    await fixture.git(fixture.work, "remote", "set-url", "--push", "origin", "git@github.com:generated/fork.git");
    const misrouted = await fixture.release("--dry-run", "0.34.0");
    assert.equal(misrouted.code, 1);
    assert.match(misrouted.stderr, /pushes to git@github\.com:generated\/fork\.git, not github\.com\/mbianchidev\/moguri/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a dry run resumes an existing open release PR instead of creating another bump", { skip: !supported, timeout: 120_000 }, async () => {
  const fixture = await generatedRelease();
  try {
    const head = (await fixture.git(fixture.work, "rev-parse", "HEAD")).stdout.trim();
    await fixture.git(fixture.work, "push", "--quiet", "origin", `${head}:refs/heads/release/v0.33.0`);
    await writeFile(fixture.env.FAKE_GH_PRS!, `OPEN\thttps://github.com/mbianchidev/moguri/pull/900\t${head}\tnone\tfalse\n`);
    const result = await fixture.release("--dry-run", "0.33.0");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`state: pr-open[\\s\\S]*Resume https://github\\.com/mbianchidev/moguri/pull/900 at ${head}`));
    await writeFile(fixture.env.FAKE_GH_PRS!, `CLOSED\thttps://github.com/mbianchidev/moguri/pull/900\t${head}\tnone\tfalse\n`);
    const closed = await fixture.release("--dry-run", "0.33.0");
    assert.equal(closed.code, 1);
    assert.match(closed.stderr, /closed without merging/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
