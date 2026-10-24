import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ProjectRepositoryLayout } from "../../../packages/protocol/src/index.ts";
import { matchesFolder } from "./project-policy.ts";
import { runProgram } from "./program.ts";

export async function repositoryLayout(root: string, denied: string[], signal: AbortSignal, limits = { entries: 20_000, ms: 2000 }): Promise<ProjectRepositoryLayout> {
  const canonical = await realpath(root), before = await lstat(canonical), pending = [canonical], roots: string[] = [];
  const deadline = Date.now() + limits.ms;
  let entries = 0, complete = true, diagnostic = "Complete bounded Local inspection. Directory links were not followed.";
  while (pending.length) {
    signal.throwIfAborted();
    if (Date.now() >= deadline || entries >= limits.entries) { complete = false; diagnostic = "Repository inspection reached its bound. Choose a narrower attached folder; no single repository was inferred."; break; }
    const directory = pending.pop()!;
    const path = relative(canonical, directory) || ".";
    if (matchesFolder(path, denied)) { complete = false; diagnostic = "Denied folders prevent a complete repository count. No hidden repository was guessed."; continue; }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal.throwIfAborted();
      if (++entries > limits.entries || Date.now() >= deadline) { complete = false; diagnostic = "Repository inspection reached its bound. Choose a narrower attached folder."; break; }
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      if (entry.name === ".git" && (metadata.isDirectory() || metadata.isFile())) {
        const result = await runProgram("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "--show-toplevel"], {
          cwd: directory, signal, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" }, label: "Verify explicit Local repository root", timeoutMs: 3000, maxBytes: 8192,
        });
        if (await realpath(result.replace(/\r?\n$/, "")) !== directory) throw new Error("The detected Git marker did not verify its exact canonical directory. No parent repository was adopted.");
        roots.push(directory);
        if (roots.length > 1) {
          complete = false; diagnostic = "More than one actual repository was found. No single upstream setting applies; inspection stopped.";
          pending.length = 0; break;
        }
      } else if (metadata.isDirectory()) pending.push(path);
    }
  }
  const after = await lstat(canonical);
  if (before.dev !== after.dev || before.ino !== after.ino || await realpath(root) !== canonical) throw new Error("The attached root changed during repository inspection. Review the actual project again.");
  return { roots, complete, diagnostic };
}
