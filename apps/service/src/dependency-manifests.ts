import { lstat, readdir, realpath } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { parseDocument } from "yaml";
import { satisfies, valid, validRange } from "semver";
import { isRecord, MoguriError, type DependencyPackage, type Project } from "../../../packages/protocol/src/index.ts";
import type { DependencyManifest } from "../../../packages/protocol/src/workspace.ts";
import { readProjectFile } from "./files.ts";

const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const packageLocation = /^(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:\/node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)*$/;
export interface NodeManifest extends DependencyManifest { directory: string; raw: Record<string, unknown>; text: string }
export interface NodeDependencyTree {
  manifests: NodeManifest[]; packages: DependencyPackage[]; lock: { path: string; text: string; digest: string };
  workspaceFile: { path: string; text: string; digest: string } | null;
}
export async function dependencyRoot(project: Project): Promise<{ path: string; device: string; inode: string }> {
  const metadata = await lstat(project.path), path = await realpath(project.path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || path !== resolve(project.path)) throw new MoguriError("cache_root", "Dependency plans require the exact canonical nonsymlink project/worktree root; no replaced root or alternate checkout was used.", 409);
  return { path, device: String(metadata.dev), inode: String(metadata.ino) };
}
export const registryRange = (value: unknown): value is string => typeof value === "string" && value.length <= 300 && validRange(value) !== null;
function lockedVersion(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000 || !valid(value.split("(")[0]!)) return false;
  const suffix = value.slice(value.split("(")[0]!.length);
  if (/[^A-Za-z0-9@._+()/-]/.test(suffix) || suffix.includes("..")) return false;
  let depth = 0;
  for (const character of suffix) {
    if (character === "(") depth++;
    else if (character === ")") { if (--depth < 0) return false; }
    else if (!depth) return false;
  }
  return depth === 0;
}
export function validateOverrides(value: unknown): void {
  if (value === undefined) return;
  if (typeof value === "string" && (registryRange(value) || /^\$[A-Za-z0-9@/._-]+$/.test(value))) return;
  if (isRecord(value)) { for (const entry of Object.values(value)) validateOverrides(entry); return; }
  throw new MoguriError("cache_resolution", "Overrides must remain registry version ranges. Local, Git, URL and executable resolutions are not admitted.");
}
export async function safeManifestPath(root: string, path: string): Promise<void> {
  if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part === "node_modules")) {
    throw new MoguriError("cache_workspace", "Workspace manifests must remain at explicit non-hidden, in-root paths without traversal.");
  }
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new MoguriError("cache_workspace", "Workspace manifests and every member ancestor must be nonsymlink in-root paths.");
  }
}
async function workspaceDirectories(root: string, patterns: string[]): Promise<string[]> {
  const result = new Set<string>();
  let visited = 0;
  async function walk(path: string, parts: string[], depth = 0): Promise<void> {
    if (++visited > 2000 || depth > 16) throw new MoguriError("cache_limit", "Workspace discovery exceeds its bounded directory/depth limit.");
    if (!parts.length) {
      if (!path) throw new MoguriError("cache_workspace", "A workspace member cannot be the root itself.");
      await safeManifestPath(root, `${path}/package.json`); result.add(path); return;
    }
    const [part, ...rest] = parts;
    if (part !== "*" && part !== "**") {
      const next = path ? `${path}/${part}` : part!;
      await safeManifestPath(root, next);
      if (!(await lstat(join(root, next))).isDirectory()) throw new MoguriError("cache_workspace", "A workspace member pattern must identify directories.");
      await walk(next, rest, depth + 1); return;
    }
    if (part === "**" && path) {
      const manifest = await lstat(join(root, path, "package.json")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (rest.length || manifest) await walk(path, rest, depth + 1);
    }
    const entries = await readdir(join(root, path), { withFileTypes: true });
    if (entries.length > 2000) throw new MoguriError("cache_limit", "A workspace member directory exceeded its bounded entry count.");
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) throw new MoguriError("cache_workspace", "Workspace member discovery encountered a symlink; no linked member was admitted.");
      if (!entry.isDirectory()) continue;
      await walk(path ? `${path}/${entry.name}` : entry.name, part === "**" ? parts : rest, depth + 1);
    }
  }
  for (const pattern of patterns) {
    if (!/^[A-Za-z0-9_*@/-]+$/.test(pattern) || pattern.startsWith("/") || pattern.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part === "node_modules" || part.includes("*") && !["*", "**"].includes(part))) {
      throw new MoguriError("cache_workspace", "Use explicit in-root workspace members or bounded * / ** directory patterns. Negations, traversal and external members are not admitted.");
    }
    await walk(pattern.startsWith("./") ? pattern.slice(2) : "", pattern.split("/"));
  }
  if (result.size > 200) throw new MoguriError("cache_limit", "A managed workspace is limited to 200 exact member manifests.");
  return [...result].sort();
}
function patterns(raw: unknown): string[] {
  if (isRecord(raw) && Object.keys(raw).every((key) => key === "packages")) raw = raw.packages;
  if (!Array.isArray(raw) || !raw.length || raw.some((entry) => typeof entry !== "string")) throw new MoguriError("cache_workspace", "Workspaces must enumerate package paths. Unknown workspace configuration is not executed.");
  return raw as string[];
}
function yamlObject(text: string): Record<string, unknown> {
  const document = parseDocument(text, { uniqueKeys: true, schema: "core" });
  if (document.errors.length) throw new MoguriError("cache_lock", "The workspace/lock YAML contains invalid or duplicate fields.");
  const data: unknown = document.toJS({ maxAliasCount: 10 });
  if (!isRecord(data)) throw new MoguriError("cache_lock", "The workspace/lock YAML needs a mapping.");
  return data;
}
function localReference(manifest: NodeManifest, name: string, value: unknown, members: Map<string, NodeManifest>, manager: "npm" | "pnpm"): boolean {
  if (typeof value !== "string") return false;
  const member = members.get(name);
  if (value.startsWith("workspace:")) {
    const range = value.slice(10);
    if (manager !== "pnpm" || !member || typeof member.raw.version !== "string" || !["*", "^", "~"].includes(range) && (!registryRange(range) || !satisfies(member.raw.version, range))) throw new MoguriError("cache_workspace", "A workspace protocol reference must match the exact reviewed pnpm member and its version.");
    return true;
  }
  if (value.startsWith("file:") || value.startsWith("link:")) {
    const target = posix.normalize(posix.join(manifest.directory, value.slice(5)));
    if (!member || value.includes("\\") || value.slice(5).startsWith("/") || target !== member.directory || value.startsWith("link:") && manager !== "pnpm") throw new MoguriError("cache_workspace", "Local references may only link another exact reviewed workspace member, never an arbitrary file or directory.");
    return true;
  }
  return false;
}
export function sanitizedManifest(raw: Record<string, unknown>, members: boolean): Record<string, unknown> {
  return Object.fromEntries(["name", "version", "private", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "engines", "os", "cpu", "overrides", ...(members ? ["workspaces"] : [])].filter((key) => key in raw).map((key) => [key, raw[key]]));
}
export async function inspectNodeDependencyTree(project: Project, manager: "npm" | "pnpm", entry: (name: unknown, version: unknown, integrity: unknown, resolved?: unknown, hasInstallScript?: boolean) => DependencyPackage): Promise<NodeDependencyTree> {
  await safeManifestPath(project.path, "package.json");
  const rootFile = await readProjectFile(project.path, "package.json", 2 * 1024 * 1024);
  let root: unknown;
  try { root = JSON.parse(rootFile.text); } catch { throw new MoguriError("cache_manifest", "package.json is not valid JSON."); }
  if (!isRecord(root)) throw new MoguriError("cache_manifest", "package.json must contain an object.");
  let directories = root.workspaces === undefined ? [] : await workspaceDirectories(project.path, patterns(root.workspaces));
  let workspaceFile: NodeDependencyTree["workspaceFile"] = null;
  if (manager === "pnpm") {
    const stat = await lstat(join(project.path, "pnpm-workspace.yaml")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (stat) {
      await safeManifestPath(project.path, "pnpm-workspace.yaml");
      workspaceFile = { ...await readProjectFile(project.path, "pnpm-workspace.yaml", 2 * 1024 * 1024), path: "pnpm-workspace.yaml" };
      const yaml = yamlObject(workspaceFile.text);
      if (Object.keys(yaml).some((key) => key !== "packages")) throw new MoguriError("cache_workspace", "Managed pnpm workspace configuration admits only package membership. Hooks, catalogs, patches and unreviewed settings require a qualified adapter.");
      const pnpmMembers = await workspaceDirectories(project.path, patterns(yaml.packages));
      if (directories.length && JSON.stringify(directories) !== JSON.stringify(pnpmMembers)) throw new MoguriError("cache_workspace", "package.json and pnpm-workspace.yaml disagree about workspace membership.");
      directories = pnpmMembers;
    }
  }
  const manifests: NodeManifest[] = [{ path: "package.json", directory: "", digest: rootFile.digest, name: typeof root.name === "string" ? root.name : null, raw: root, text: rootFile.text }];
  for (const directory of directories) {
    const file = await readProjectFile(project.path, `${directory}/package.json`, 2 * 1024 * 1024);
    let raw: unknown;
    try { raw = JSON.parse(file.text); } catch { throw new MoguriError("cache_manifest", "A workspace member manifest is not valid JSON."); }
    if (!isRecord(raw) || typeof raw.name !== "string" || !packageName.test(raw.name) || typeof raw.version !== "string" || !valid(raw.version) || raw.workspaces !== undefined) throw new MoguriError("cache_workspace", "Every member needs a unique registry-shaped name and exact version; nested undeclared workspace roots are not admitted.");
    manifests.push({ path: `${directory}/package.json`, directory, digest: file.digest, name: raw.name, raw, text: file.text });
  }
  const members = new Map(manifests.slice(1).map((manifest) => [manifest.name!, manifest]));
  if (members.size !== directories.length || root.name && members.has(String(root.name))) throw new MoguriError("cache_workspace", "Workspace package names must be unique, including the root.");
  for (const manifest of manifests) {
    for (const section of sections) {
      const dependencies = manifest.raw[section];
      if (dependencies === undefined) continue;
      if (!isRecord(dependencies)) throw new MoguriError("cache_manifest", "Dependency sections must contain named version ranges.");
      for (const [name, range] of Object.entries(dependencies)) {
        if (!packageName.test(name) || !localReference(manifest, name, range, members, manager) && !registryRange(range)) throw new MoguriError("cache_resolution", "Declared dependencies must be registry names with semver ranges or exact approved workspace links. Tags, aliases, arbitrary local, Git and executable resolutions are blocked.");
      }
    }
    validateOverrides(manifest.raw.overrides);
  }
  const lockName = manager === "npm" ? "package-lock.json" : "pnpm-lock.yaml";
  await safeManifestPath(project.path, lockName);
  const lock = { ...await readProjectFile(project.path, lockName, 4 * 1024 * 1024), path: lockName };
  const packages: DependencyPackage[] = [];
  if (manager === "npm") {
    let data: unknown;
    try { data = JSON.parse(lock.text); } catch { throw new MoguriError("cache_lock", "package-lock.json is not valid JSON."); }
    if (!isRecord(data) || ![2, 3].includes(Number(data.lockfileVersion)) || !isRecord(data.packages)) throw new MoguriError("cache_lock", "Use an npm version-2 or version-3 lockfile.");
    const locked = data.packages;
    for (const [path, item] of Object.entries(locked)) {
      if (!isRecord(item)) throw new MoguriError("cache_lock", "An npm locked package is invalid.");
      const member = manifests.find((manifest) => manifest.directory === path);
      if (member) {
        if (path && (item.version !== member.raw.version || item.name !== undefined && item.name !== member.name)) throw new MoguriError("cache_workspace", "The lock's workspace identity differs from its reviewed manifest.");
        continue;
      }
      let location = path;
      const prefix = directories.filter((directory) => path.startsWith(`${directory}/node_modules/`)).sort((a, b) => b.length - a.length)[0];
      if (prefix) location = path.slice(prefix.length + 1);
      if (!packageLocation.test(location)) throw new MoguriError("cache_lock", "Linked/workspace or escaping package locations must match an exact reviewed member; they were not skipped.");
      const name = location.slice(location.lastIndexOf("node_modules/") + 13);
      if (item.link) {
        if (item.link !== true || typeof item.resolved !== "string" || !members.has(name) || members.get(name)!.directory !== item.resolved || prefix) throw new MoguriError("cache_workspace", "A linked package must target the exact in-root reviewed workspace member, never an external or nested link.");
        continue;
      }
      packages.push(entry(item.name ?? name, item.version, item.integrity, item.resolved, item.hasInstallScript === true));
    }
    for (const manifest of manifests) {
      const lockedManifest = locked[manifest.directory];
      if (!isRecord(lockedManifest)) throw new MoguriError("cache_workspace", "The lock is missing a complete reviewed root/member manifest.");
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
        const declared = isRecord(manifest.raw[section]) ? manifest.raw[section] : {};
        const references = isRecord(lockedManifest[section]) ? lockedManifest[section] : {};
        if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(references).sort())) throw new MoguriError("cache_lock", "The declared dependency ranges do not match this lock. Generate and review a consistent root/member lock.");
        for (const [name, range] of Object.entries(declared)) {
          const local = localReference(manifest, name, range, members, manager) || members.has(name) && registryRange(range) && satisfies(String(members.get(name)!.raw.version), range);
          if (local) {
            const link = locked[`node_modules/${name}`];
            if (!isRecord(link) || link.link !== true || link.resolved !== members.get(name)!.directory) throw new MoguriError("cache_workspace", "The workspace dependency is not linked to its exact reviewed member in this lock.");
          } else {
            const nested = manifest.directory ? locked[`${manifest.directory}/node_modules/${name}`] : null;
            const item = isRecord(nested) ? nested : locked[`node_modules/${name}`];
            if (!isRecord(item) || typeof item.version !== "string" || !satisfies(item.version, String(range))) throw new MoguriError("cache_lock", "The declared dependency ranges do not match this lock. Generate and review a consistent lock before cache admission.");
          }
        }
      }
    }
  } else {
    const data = yamlObject(lock.text);
    if (Number(data.lockfileVersion) !== 9 || !isRecord(data.importers)) throw new MoguriError("cache_lock", "This adapter supports complete pnpm lockfile 9 importers and snapshots.");
    if (data.patchedDependencies !== undefined || data.catalogs !== undefined) throw new MoguriError("cache_resolution", "External patch/catalog dependencies require a separately reviewed adapter; external paths are not read.");
    validateOverrides(data.overrides);
    const lockedPackages = data.packages === undefined ? {} : data.packages;
    const snapshots = data.snapshots === undefined ? {} : data.snapshots;
    if (!isRecord(lockedPackages) || !isRecord(snapshots)) throw new MoguriError("cache_lock", "The pnpm packages/snapshots must be complete mappings.");
    if (Object.keys(data.importers).sort().join("\0") !== manifests.map((manifest) => manifest.directory || ".").sort().join("\0")) throw new MoguriError("cache_workspace", "Every pnpm importer must match one exact reviewed root/member manifest.");
    for (const [key, value] of Object.entries(lockedPackages)) {
      const plain = key.split("(")[0]!, at = plain.lastIndexOf("@");
      if (!isRecord(value) || !isRecord(value.resolution) || Object.keys(value.resolution).some((key) => !["integrity", "tarball"].includes(key))) throw new MoguriError("cache_lock", "pnpm resolution must contain SHA-512 integrity and optionally an explicitly authorized tarball, never directory, Git or executable fields.");
      packages.push(entry(plain.slice(0, at), plain.slice(at + 1), value.resolution.integrity, value.resolution.tarball, value.requiresBuild === true));
    }
    const validateReferences = (value: unknown, manifest?: NodeManifest) => {
      if (!isRecord(value)) throw new MoguriError("cache_lock", "Invalid pnpm dependency snapshot.");
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
        const references = value[section] ?? {};
        if (!isRecord(references)) throw new MoguriError("cache_resolution", "Invalid pnpm dependency references.");
        const declared = manifest && isRecord(manifest.raw[section]) ? manifest.raw[section] : {};
        if (manifest && Object.keys(references).sort().join("\0") !== Object.keys(declared).sort().join("\0")) throw new MoguriError("cache_lock", "A pnpm importer does not match its exact reviewed manifest dependency set.");
        for (const [name, raw] of Object.entries(references)) {
          const version = manifest && isRecord(raw) ? raw.version : raw;
          if (manifest && (!isRecord(raw) || raw.specifier !== declared[name])) throw new MoguriError("cache_lock", "A pnpm importer specifier changed from its manifest.");
          if (manifest && typeof version === "string" && version.startsWith("link:")) {
            if (!localReference(manifest, name, version, members, manager) || !localReference(manifest, name, declared[name], members, manager) && !(members.has(name) && registryRange(declared[name]) && satisfies(String(members.get(name)!.raw.version), declared[name]))) throw new MoguriError("cache_workspace", "A pnpm workspace link is not approved by the exact member manifest.");
          } else if (!packageName.test(name) || !lockedVersion(version) || !(`${name}@${version}` in snapshots) || manifest && !registryRange(declared[name])) throw new MoguriError("cache_resolution", "Every pnpm reference must resolve to an integrity-checked registry snapshot or an exact approved member. Arbitrary local, URL, Git and missing references are blocked.");
        }
      }
    };
    for (const [key, value] of Object.entries(snapshots)) {
      const base = key.split("(")[0]!;
      if (!(base in lockedPackages) || !lockedVersion(key.slice(key.lastIndexOf("@", base.length - 1) + 1))) throw new MoguriError("cache_resolution", "The pnpm snapshot has an unqualified package or peer resolution.");
      validateReferences(value);
    }
    for (const manifest of manifests) validateReferences(data.importers[manifest.directory || "."], manifest);
  }
  return { manifests, packages, lock, workspaceFile };
}
