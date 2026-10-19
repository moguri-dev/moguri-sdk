import { join, relative } from "node:path";
import ignore from "ignore";
import { readProjectFile } from "./files.ts";

export type IgnoreScope = { base: string; rules: ReturnType<typeof ignore> };
const protectedPaths = ignore().add([".git/", "node_modules/", ".moguri/", ".moguri-dependencies-*/", ".native/", "dist/", "release/", ".ssh/", ".aws/", ".env", ".env.*"]);
export async function readIgnoreScope(root: string, directory: string): Promise<IgnoreScope> {
  const rules = ignore();
  try { rules.add((await readProjectFile(root, relative(root, join(directory, ".gitignore")))).text); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  return { base: directory, rules };
}
export function ignoredPath(root: string, absolute: string, directory: boolean, chain: IgnoreScope[]): boolean {
  const suffix = directory ? "/" : "";
  if (protectedPaths.ignores(relative(root, absolute) + suffix)) return true;
  let excluded = false;
  for (const scope of chain) {
    const match = scope.rules.test(relative(scope.base, absolute) + suffix);
    if (match.ignored) excluded = true;
    if (match.unignored) excluded = false;
  }
  return excluded;
}
