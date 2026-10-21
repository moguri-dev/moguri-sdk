import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const root = await mkdtemp(join(tmpdir(), "moguri-worktree-spike-")), project = join(root, "project"), workspace = join(root, "isolated");
const started = performance.now();
const git = (args) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  await mkdir(project);
  git(["init", "--initial-branch=main"]);
  await writeFile(join(project, "generated.ts"), "export const generated = 'base';\n");
  git(["add", "--", "generated.ts"]);
  git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated workspace base"]);
  const base = git(["rev-parse", "HEAD"]), originalIndex = git(["write-tree"]);
  await writeFile(join(project, "unrelated.txt"), "Generated unrelated user edit.\n");
  git(["worktree", "add", "--lock", "--reason", "Generated Moguri ownership qualification", "-b", "moguri/generated-change", workspace, base]);
  const listed = git(["worktree", "list", "--porcelain"]);
  assert.match(listed, /locked Generated Moguri ownership qualification/);
  assert.throws(() => git(["worktree", "remove", workspace]), /locked/);
  await writeFile(join(workspace, "generated.ts"), "export const generated = 'candidate';\n");
  git(["worktree", "unlock", workspace]);
  assert.throws(() => git(["worktree", "remove", workspace]), /modified|untracked|dirty/);
  assert.equal(await readFile(join(project, "generated.ts"), "utf8"), "export const generated = 'base';\n");
  assert.equal(git(["write-tree"]), originalIndex);
  assert.equal(git(["branch", "--show-current"]), "main");
  await writeFile(join(workspace, "generated.ts"), "export const generated = 'base';\n");
  git(["worktree", "remove", workspace]);
  assert.equal(git(["rev-parse", "refs/heads/moguri/generated-change"]), base);
  assert.equal(await readFile(join(project, "unrelated.txt"), "utf8"), "Generated unrelated user edit.\n");
  console.log(JSON.stringify({ status: "PASS", primitive: "Actual isolated Git worktree, locked/dirty removal refusal, preserved checkout/index/user edit and preserved branch", ms: performance.now() - started, qualification: "Git primitive only. Moguri ownership leases, durable change sets, recovery and SDK/client surfaces still need implementation." }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
