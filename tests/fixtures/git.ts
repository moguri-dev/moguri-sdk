import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const generatedGit = async (cwd: string, ...args: string[]) => (await execute("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", ...args], {
  cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
})).stdout.trim();
export async function generatedRepository(root: string, remote?: string) {
  await generatedGit(root, "init", "--initial-branch=fixture-base");
  await generatedGit(root, "config", "user.name", "Generated Fixture");
  await generatedGit(root, "config", "user.email", "generated@example.invalid");
  await generatedGit(root, "add", "fixture.txt");
  await generatedGit(root, "commit", "--no-gpg-sign", "-m", "Generated base");
  if (remote) {
    await generatedGit(root, "init", "--bare", remote);
    await generatedGit(root, "remote", "add", "origin", remote);
  }
}
