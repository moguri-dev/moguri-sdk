import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath, scopedPath } from "./files.ts";
import { validateProjectPath } from "./project-policy.ts";

export async function prepareProjectDirectory(root: string, path: string, options: { signal?: AbortSignal; created?: (path: string) => void } = {}): Promise<void> {
  validateProjectPath(path);
  if (isProtectedProjectPath(path)) throw new MoguriError("project_path", "Plan/default paths cannot enter protected directories.");
  const parts = path.replaceAll("\\", "/").split("/").slice(0, -1).filter((part) => part && part !== ".");
  if (parts.length > 256) throw new MoguriError("project_path", "Plan/default paths support at most 256 parent directories.");
  let current = await realpath(root);
  for (let index = 0; index < parts.length; index++) {
    options.signal?.throwIfAborted();
    current = join(current, parts[index]!);
    let created = true;
    try { await mkdir(current, { mode: 0o755 }); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; created = false; }
    if (created) options.created?.(parts.slice(0, index + 1).join("/"));
    await scopedPath(root, `${current}/.`);
  }
  options.signal?.throwIfAborted();
}
