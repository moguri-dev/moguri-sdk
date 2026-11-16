import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import { isProtectedProjectPath, readRegularFileSync } from "./files.ts";

/** One logical entry below a Local skill source. `path` stays relative to the source; `real` is where its bytes live. */
export type SkillTreeEntry =
  | { path: string; real: string; kind: "file" | "directory"; link: boolean }
  | { path: string; real: null; kind: "broken" | "cycle" | "protected" | "special"; link: true | false };
export const SKILL_TREE_DEPTH = 16, SKILL_TREE_ENTRIES = 10_000;

const code = (error: unknown) => error instanceof Error && "code" in error ? String(error.code) : "";
const outside = (rel: string) => !rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`);
/** Links may leave the source, as other agent harnesses allow, but never into secret locations such as ~/.ssh or key files. */
export function protectedLinkTarget(real: string): boolean {
  const home = relative(homedir(), real);
  return isProtectedProjectPath(outside(home) ? real : home);
}
function classify(path: string, logical: string, ancestors: ReadonlySet<string>): SkillTreeEntry {
  const own = lstatSync(path), link = own.isSymbolicLink();
  let real = path, metadata = own;
  if (link) {
    try { real = realpathSync(path); metadata = statSync(real); }
    catch (error) { if (["ENOENT", "ELOOP", "ENOTDIR", "EACCES"].includes(code(error))) return { path: logical, real: null, kind: "broken", link }; throw error; }
    if (protectedLinkTarget(real)) return { path: logical, real: null, kind: "protected", link };
  }
  if (metadata.isDirectory()) return ancestors.has(real) ? { path: logical, real: null, kind: "cycle", link } : { path: logical, real, kind: "directory", link };
  if (metadata.isFile()) return { path: logical, real, kind: "file", link };
  return { path: logical, real: null, kind: "special", link };
}
export const skillTreeProblem = (entry: SkillTreeEntry): string => ({
  broken: `${entry.path} is a broken or unreadable link`, cycle: `${entry.path} links back into its own folder`,
  protected: `${entry.path} links into a protected location such as credentials or keys`, special: `${entry.path} is not a regular file or folder`,
  file: "", directory: "" })[entry.kind];

/** Resolves a logical source path through any links, applying the same target rules as the walker. */
export function resolveSkillPath(root: string, logical: string, links: [string, string][] = []): string {
  if (!logical || logical === ".") return root;
  const parts = logical.split(/[\\/]/);
  if (isAbsolute(logical) || parts.some((part) => !part || part === "." || part === "..")) throw new MoguriError("skill_source_changed", "The reviewed skill path is not a plain relative source path.", 409);
  let current = root, prefix = "";
  const ancestors = new Set([root]);
  for (const part of parts) {
    prefix = prefix ? join(prefix, part) : part;
    let entry: SkillTreeEntry;
    try { entry = classify(join(current, part), prefix, ancestors); }
    catch (error) { if (code(error) === "ENOENT") throw new MoguriError("skill_source_changed", `${prefix} no longer exists in the skill source. Fresh review is required.`, 409); throw error; }
    if (entry.real === null) throw new MoguriError("skill_source_changed", `${skillTreeProblem(entry)}. Fresh review is required.`, 409);
    if (entry.link) links.push([entry.path, entry.real]);
    current = entry.real;
    if (entry.kind === "directory") ancestors.add(current);
  }
  return current;
}

/** Walks a Local skill source in name order, following links to real files and folders while refusing cycles and protected targets. */
export function walkSkillTree(root: string, start: string, visit: (entry: SkillTreeEntry) => boolean | void,
  options: { limit: (reason: "depth" | "entries") => MoguriError; signal?: AbortSignal; links?: [string, string][] }): void {
  const begin = resolveSkillPath(root, start, options.links);
  let entries = 0;
  const walk = (real: string, logical: string, depth: number, ancestors: ReadonlySet<string>) => {
    options.signal?.throwIfAborted();
    if (depth > SKILL_TREE_DEPTH) throw options.limit("depth");
    for (const name of readdirSync(real).sort((a, b) => a.localeCompare(b))) {
      options.signal?.throwIfAborted();
      if (++entries > SKILL_TREE_ENTRIES) throw options.limit("entries");
      const entry = classify(join(real, name), logical ? join(logical, name) : name, ancestors);
      if (entry.link && entry.real) options.links?.push([entry.path, entry.real]);
      if (visit(entry) && entry.kind === "directory") walk(entry.real, entry.path, depth + 1, new Set([...ancestors, entry.real]));
    }
  };
  walk(begin, start === "." ? "" : start, 0, new Set([root, begin]));
}

export function readSkillText(real: string, maxBytes: number): { text: string; digest: string; bytes: number } {
  let bytes: Buffer;
  try { bytes = readRegularFileSync(real, maxBytes); }
  catch (error) {
    if (error instanceof MoguriError && error.code === "file_limit") throw new MoguriError("file_limit", `Only regular files up to ${Math.ceil(maxBytes / 1024)} KiB are supported. No prefix was captured.`);
    throw error;
  }
  if (bytes.includes(0) || !isUtf8(bytes)) throw new MoguriError("file_limit", "The file is binary or not valid UTF-8.");
  return { text: bytes.toString("utf8"), digest: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
