import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath, scopedPath } from "./files.ts";
import { validateProjectPath } from "./project-policy.ts";

export async function inspectProjectDirectory(root: string, path: string): Promise<void> {
  validateProjectPath(path);
  if (isProtectedProjectPath(path)) throw new MoguriError("project_path", "Review paths cannot enter protected directories.");
  const parts = path.split("/").slice(0, -1);
  if (parts.length > 256) throw new MoguriError("project_path", "Review paths support at most 256 parent directories.");
  for (let index = 0; index < parts.length; index++) {
    const name = parts.slice(0, index + 1).join("/");
    const target = await scopedPath(root, name, true);
    try { if (!(await lstat(target)).isDirectory()) throw new MoguriError("project_path", "A reviewed parent is not a directory."); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
  }
}
export async function prepareProjectDirectory(root: string, path: string, options: { signal?: AbortSignal; created?: (path: string) => void; beforeCreate?: () => void } = {}): Promise<void> {
  validateProjectPath(path);
  if (isProtectedProjectPath(path)) throw new MoguriError("project_path", "Plan/default paths cannot enter protected directories.");
  const parts = path.replaceAll("\\", "/").split("/").slice(0, -1).filter((part) => part && part !== ".");
  if (parts.length > 256) throw new MoguriError("project_path", "Plan/default paths support at most 256 parent directories.");
  let current = await realpath(root);
  for (let index = 0; index < parts.length; index++) {
    options.signal?.throwIfAborted();
    current = join(current, parts[index]!);
    options.beforeCreate?.();
    let created = true;
    try { await mkdir(current, { mode: 0o755 }); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; created = false; }
    if (created) options.created?.(parts.slice(0, index + 1).join("/"));
    await scopedPath(root, `${current}/.`);
  }
  options.signal?.throwIfAborted();
}
