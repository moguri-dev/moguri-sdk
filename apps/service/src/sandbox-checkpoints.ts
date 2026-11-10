import { isUtf8 } from "node:buffer";
import { posix } from "node:path";
import ignore from "ignore";
import {
  CHECKPOINT_FILE_BYTES, CHECKPOINT_WORKSPACE_BYTES, CheckpointWorkspaceSchema, MoguriError, parse,
  type CheckpointBoundary, type CheckpointFile, type CheckpointRoot, type CheckpointWorkspace,
} from "../../../packages/protocol/src/index.ts";
import { bytesDigest, isPrivateContextPath, isProtectedProjectPath } from "./files.ts";
import { ignoredPath, type IgnoreScope } from "./ignore-rules.ts";
import { matchesFolder, type FolderPolicy } from "./project-policy.ts";
import {
  NATIVE_TREE_FILE_BYTES, nativePrivateDigest, nativePrivateVersion, validateNativePrivateEntries,
  type NativePrivateEntry, type NativePrivateSource, type NativeStage,
} from "./native-staging.ts";
import type { readNativeCompletion } from "./native-evidence.ts";
import { frameDigest } from "./worker-wire.ts";

type Completion = Awaited<ReturnType<typeof readNativeCompletion>>;
export interface NativeCheckpointRoot { key: string; repositoryId: string | null; directory: string; policy: FolderPolicy }
function fail(message: string): never { throw new MoguriError("sandbox_checkpoint", `${message} Original stages, signed data and accounting remain retained; no Local checkout or effect replay was used.`, 409); }
const ordered = (entries: Iterable<NativePrivateEntry>) => [...entries].sort((a, b) => a.path.localeCompare(b.path));
const metadataDigest = (entries: readonly NativePrivateEntry[]) => frameDigest(entries.map((entry) => [entry.path, nativePrivateVersion(entry)]));
export function nativeCheckpointTreeDigest(source: NativePrivateSource): string {
  return frameDigest({ root: source.root, identity: source.identity, entries: metadataDigest(source.entries) });
}
export async function nativeSignedPrivateSource(stage: NativeStage, evidence: Completion, before: boolean,
  verify: () => Promise<void>, signal: AbortSignal, check: () => void): Promise<NativePrivateSource> {
  const saved = before ? evidence.beforeEntries : evidence.entries, read = before ? evidence.readBefore : evidence.read;
  const entries: NativePrivateEntry[] = [];
  for (const entry of saved) {
    check(); signal.throwIfAborted();
    if (entry.mode > 0o777) fail("A complete signed private snapshot contains an unsupported set-id/sticky mode.");
    if (entry.kind.type === "directory") entries.push({ path: entry.path, type: "directory", mode: entry.mode });
    else if (entry.kind.type === "symlink") entries.push({ path: entry.path, type: "symlink", mode: entry.mode, target: String(entry.kind.target) });
    else {
      if (!["regular", "hardlink"].includes(String(entry.kind.type))) fail("A complete signed private snapshot contains an unsupported special file.");
      const file = await read(entry.path, NATIVE_TREE_FILE_BYTES);
      entries.push({ path: entry.path, type: "regular", mode: entry.mode, digest: file.digest, bytes: file.content.length });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path)); validateNativePrivateEntries(entries);
  const source = { stage, root: stage.workspace, identity: stage.workspaceIdentity, entries };
  await verify(); check(); signal.throwIfAborted();
  return { ...source, digest: nativePrivateDigest(source), verify: async () => { check(); signal.throwIfAborted(); await verify(); },
    read: async (path) => {
      check(); signal.throwIfAborted();
      const entry = entries.find((entry) => entry.path === path);
      if (entry?.type !== "regular") fail("The original signed regular file is unavailable.");
      const result = await read(path, NATIVE_TREE_FILE_BYTES);
      if (result.digest !== entry.digest || result.content.length !== entry.bytes) fail("Original signed snapshot bytes changed.");
      return result.content;
    } };
}
export function mergeNativeRollback(after: NativePrivateSource, before: NativePrivateSource, live: NativePrivateSource): NativePrivateSource {
  const baseline = new Map(before.entries.map((entry) => [entry.path, entry])), current = new Map(live.entries.map((entry) => [entry.path, entry]));
  const entries = new Map(after.entries.map((entry) => [entry.path, entry])), external = new Set<string>();
  const changes = new Set([...baseline.keys(), ...current.keys()]);
  for (const path of changes) {
    const was = baseline.get(path), actual = current.get(path);
    if (nativePrivateVersion(was) === nativePrivateVersion(actual)) continue;
    external.add(path);
    if (was?.type === "directory" && actual?.type !== "directory") {
      for (const [child, entry] of entries) if (child.startsWith(`${path}/`)) {
        if (nativePrivateVersion(entry) !== nativePrivateVersion(baseline.get(child))) {
          fail("External directory replacement overlaps retained worker work. Inspect both original trees; no subtree was silently chosen.");
        }
        entries.delete(child);
      }
    }
    if (actual) entries.set(path, actual); else entries.delete(path);
  }
  const source = { stage: live.stage, root: live.root, identity: live.identity, entries: ordered(entries.values()) };
  validateNativePrivateEntries(source.entries);
  return { ...source, digest: nativePrivateDigest(source),
    verify: async () => { await after.verify(); await before.verify(); await live.verify(); },
    read: (path) => external.has(path) ? live.read(path) : after.read(path) };
}
export async function nativeCheckpointRetrySource(source: NativePrivateSource, roots: NativeCheckpointRoot[]): Promise<NativePrivateSource> {
  const gitRoots = new Set<string>();
  for (const root of roots) await nativeCheckpointGit(source, root.directory, gitRoots);
  await nativeCheckpointNestedGit(source, gitRoots);
  const entries = source.entries.filter((entry) => !isProtectedProjectPath(entry.path) ||
    [...gitRoots].some((root) => root !== "." && (entry.path === root || entry.path.startsWith(`${root}/`))));
  validateNativePrivateEntries(entries);
  const value = { stage: source.stage, root: source.root, identity: source.identity, entries };
  return { ...value, digest: nativePrivateDigest(value), read: (path) => source.read(path), verify: () => source.verify() };
}
function privateRelative(base: string, value: string): string {
  if (!value || value.length > 4096 || /[\\\0\r\n]/.test(value)) fail("Private Git metadata points outside its same owned workspace.");
  if (value.startsWith("/")) {
    if (!value.startsWith("/workspace/")) fail("Private Git metadata has an absolute pointer outside the captured native /workspace mount. No host path or different stage was followed.");
    value = value.slice("/workspace/".length); base = "";
  }
  const path = posix.normalize(posix.join(base, value));
  if (path === ".." || path.startsWith("../") || path.startsWith("/")) fail("Private Git metadata points outside its same owned workspace.");
  return path === "." ? "" : path;
}
export async function nativeCheckpointGit(source: NativePrivateSource, directory: string, protectedRoots = new Set<string>()): Promise<CheckpointRoot["git"]> {
  const entries = new Map(source.entries.map((entry) => [entry.path, entry]));
  const read = async (path: string, maximum = CHECKPOINT_FILE_BYTES): Promise<string | null> => {
    const entry = entries.get(path);
    if (!entry) return null;
    if (entry.type !== "regular" || entry.bytes! > maximum) fail("Current private Git metadata is linked, oversized or non-regular.");
    const bytes = await source.read(path);
    if (!isUtf8(bytes) || bytes.includes(0)) fail("Current private Git metadata is not exact UTF-8.");
    return bytes.toString("utf8");
  };
  let git = directory ? `${directory}/.git` : ".git";
  const location = entries.get(git) ?? source.entries.find((entry) => posix.dirname(entry.path) === (directory || ".") && posix.basename(entry.path).toLowerCase() === ".git");
  if (!location) return null;
  git = location.path;
  protectedRoots.add(git);
  if (location.type === "regular") {
    const value = await read(git, 4096);
    if (!value?.startsWith("gitdir: ") || !value.endsWith("\n") || value.trimEnd().includes("\n")) fail("A private Git pointer has an unsupported layout.");
    git = privateRelative(directory, value.slice(8).trimEnd());
  } else if (location.type !== "directory") fail("Current private Git metadata aliases an unowned filesystem root.");
  protectedRoots.add(git);
  if (entries.get(git)?.type !== "directory") fail("Current private Git metadata is outside this same owned workspace.");
  const commonPointer = await read(`${git}/commondir`, 4096), common = commonPointer === null ? git : privateRelative(git, commonPointer.trimEnd());
  if (entries.get(common)?.type !== "directory") fail("Current private Git common metadata is outside this same owned workspace.");
  protectedRoots.add(common);
  if (entries.has(`${common}/reftable`)) fail("Current private Git uses an unqualified reftable HEAD layout. Its bytes/history remain retained; unknown refs were not labelled as an unborn or absent HEAD.");
  for (const entry of source.entries) if ((entry.path.startsWith(`${git}/`) || entry.path.startsWith(`${common}/`)) && entry.type === "symlink") {
    fail("Current private Git metadata contains a linked path. Its exact old stage was retained, not followed.");
  }
  const alternates = await read(`${common}/objects/info/alternates`);
  if (alternates?.trim()) for (const path of alternates.trimEnd().split("\n")) {
    const target = privateRelative(`${common}/objects`, path);
    if (entries.get(target)?.type !== "directory") fail("Current private Git object alternates are outside this same owned workspace.");
    protectedRoots.add(target);
  }
  const packed = await read(`${common}/packed-refs`), packedRefs = new Map<string, string>();
  if (packed) for (const line of packed.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) (refs\/[^\s]+)$/.exec(line);
    if (!match) fail("Current private packed Git refs have an unsupported layout.");
    packedRefs.set(match[2]!, match[1]!);
  }
  let value = await read(`${git}/HEAD`, 4096), head: string | null = null;
  if (value === null) fail("Current private Git has no retained HEAD; no parent repository was inferred.");
  const visited = new Set<string>();
  for (let depth = 0; depth < 16; depth++) {
    const text = value!.trimEnd();
    if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text)) { head = text; break; }
    if (!text.startsWith("ref: refs/") || /[\u0000-\u0020\\]/.test(text.slice(5)) || visited.has(text)) fail("Current private Git HEAD/ref intent is unsupported or cyclic.");
    visited.add(text);
    const name = text.slice(5);
    if (name.split("/").some((part) => !part || part === "." || part === "..")) fail("Current private Git HEAD traverses an invalid ref.");
    value = await read(`${common}/${name}`, 4096);
    if (value === null) { head = packedRefs.get(name) ?? null; break; }
    if (depth === 15) fail("Current private Git symbolic refs exceed 16 levels.");
  }
  const index = entries.get(`${git}/index`);
  if (index && index.type !== "regular") fail("The current private staged index is linked or non-regular.");
  return { head, indexDigest: index?.digest ?? null };
}
async function nativeCheckpointNestedGit(source: NativePrivateSource, protectedRoots: Set<string>): Promise<void> {
  const markers = source.entries.filter((entry) => posix.basename(entry.path).toLowerCase() === ".git" &&
    !isProtectedProjectPath(posix.dirname(entry.path)));
  if (markers.length > 1000) fail("Complete private Git inspection exceeds 1,000 metadata roots. No nested history was silently omitted.");
  for (const entry of markers) await nativeCheckpointGit(source, posix.dirname(entry.path) === "." ? "" : posix.dirname(entry.path), protectedRoots);
  const entries = new Map(source.entries.map((entry) => [entry.path, entry]));
  for (const entry of source.entries) if (posix.basename(entry.path) === "HEAD" && !isProtectedProjectPath(entry.path) &&
    ![...protectedRoots].some((root) => entry.path === root || entry.path.startsWith(`${root}/`))) {
    const root = posix.dirname(entry.path), path = (name: string) => posix.join(root, name);
    if (entries.get(path("config"))?.type === "regular" && entries.get(path("objects"))?.type === "directory" &&
      entries.get(path("refs"))?.type === "directory") protectedRoots.add(root);
  }
}
async function ignoredPrivate(source: NativePrivateSource, path: string, directory: boolean, root: string,
  scopes: Map<string, IgnoreScope>): Promise<boolean> {
  const chain: IgnoreScope[] = [];
  const relative = root ? path.slice(root.length + 1) : path, member = relative.split("/");
  for (let index = 0; index < member.length; index++) {
    const prefix = [root, ...member.slice(0, index)].filter(Boolean).join("/"), base = prefix ? `${source.root}/${prefix}` : source.root;
    let scope = scopes.get(prefix);
    if (!scope) {
      const entry = source.entries.find((entry) => entry.path === [prefix, ".gitignore"].filter(Boolean).join("/")), rules = ignore();
      if (entry) {
        if (entry.type !== "regular" || entry.bytes! > 128 * 1024) fail("An applicable private .gitignore is non-regular or exceeds 128 KiB.");
        const content = await source.read(entry.path);
        if (!isUtf8(content) || content.includes(0)) fail("An applicable private .gitignore is not exact UTF-8.");
        rules.add(content.toString("utf8"));
      }
      scope = { base, rules }; scopes.set(prefix, scope);
    }
    chain.push(scope);
    const absolute = `${source.root}/${[root, ...member.slice(0, index + 1)].filter(Boolean).join("/")}`;
    if (ignoredPath(source.root, absolute, index < member.length - 1 || directory, chain)) return true;
  }
  return false;
}
export async function nativeCheckpointWorkspace(source: NativePrivateSource, bindings: NativeCheckpointRoot[], boundary: CheckpointBoundary,
  signal: AbortSignal, check: () => void): Promise<CheckpointWorkspace> {
  const roots: CheckpointRoot[] = []; let bytes = 0, files = 0;
  if (bindings.some((binding) => binding.directory) && source.entries.some((entry) => entry.type !== "directory" &&
    !isProtectedProjectPath(entry.path) && !bindings.some((binding) => entry.path.startsWith(`${binding.directory}/`)))) {
    fail("A complete captured-group snapshot has unprotected work outside its original repository directories. No member/default root was inferred.");
  }
  const protectedRoots = new Set<string>(), git = new Map<string, CheckpointRoot["git"]>();
  for (const binding of bindings) git.set(binding.key, await nativeCheckpointGit(source, binding.directory, protectedRoots));
  await nativeCheckpointNestedGit(source, protectedRoots);
  for (const binding of bindings) {
    const values: CheckpointFile[] = [], excluded: string[] = [], scopes = new Map<string, IgnoreScope>();
    for (const entry of source.entries) {
      check(); signal.throwIfAborted();
      if (binding.directory && !entry.path.startsWith(`${binding.directory}/`)) continue;
      const relative = binding.directory ? entry.path.slice(binding.directory.length + 1) : entry.path;
      if (excluded.some((path) => entry.path === path || entry.path.startsWith(`${path}/`))) continue;
      if (isPrivateContextPath(relative) || [...protectedRoots].some((path) => path === "." || entry.path === path || entry.path.startsWith(`${path}/`)) ||
        matchesFolder(relative, binding.policy.denied) || entry.type === "symlink" ||
        await ignoredPrivate(source, entry.path, entry.type === "directory", binding.directory, scopes)) {
        excluded.push(entry.path); continue;
      }
      if (entry.type === "directory") continue;
      if (++files > 2000 || entry.bytes! > CHECKPOINT_FILE_BYTES || (bytes += entry.bytes!) > CHECKPOINT_WORKSPACE_BYTES) {
        fail("The complete unprotected checkpoint exceeds 2,000 files, 2 MiB per file or 16 MiB total. No subset or absent dependency was fabricated.");
      }
      const content = await source.read(entry.path);
      values.push({ path: entry.path, digest: entry.digest!, bytes: entry.bytes!, mode: entry.mode, content: content.toString("base64"),
        ...(entry.identity ? { identity: { ...entry.identity } } : {}) } as CheckpointFile);
    }
    roots.push({ key: binding.key, repositoryId: binding.repositoryId,
      binding: { root: source.root, device: source.identity.device, inode: source.identity.inode },
      files: values, excluded, git: git.get(binding.key)! });
  }
  await source.verify(); check(); signal.throwIfAborted();
  const value = { version: 1 as const, roots, bytes, boundary };
  return { ...value, digest: frameDigest(value) };
}
export function assertNativeCheckpoint(workspace: CheckpointWorkspace): void {
  const value = parse(CheckpointWorkspaceSchema, workspace), { digest, ...body } = value;
  if (digest !== frameDigest(body) || value.boundary?.env !== "Sandbox" || value.roots.length < 1 ||
    new Set(value.roots.map((root) => root.key)).size !== value.roots.length) fail("An exact private checkpoint lost its complete boundary/digest/root keys.");
  let bytes = 0, count = 0;
  for (const root of value.roots) {
    const names = new Set<string>();
    if (!root.key) fail("A private checkpoint has no stable logical root key.");
    for (const file of root.files) {
      const key = file.path.normalize("NFC").toLowerCase(), content = Buffer.from(file.content, "base64");
      if (!file.path.isWellFormed() || file.path.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(file.path) ||
        file.path.split("/").some((part) => !part || part === "." || part === "..") || isPrivateContextPath(file.path) ||
        names.has(key) || content.toString("base64") !== file.content || content.length !== file.bytes || bytesDigest(content) !== file.digest) {
        fail("A private checkpoint file has unsafe/protected paths or changed exact binary bytes.");
      }
      names.add(key); bytes += file.bytes; count++;
    }
  }
  if (count > 2000 || bytes !== value.bytes || bytes > CHECKPOINT_WORKSPACE_BYTES) fail("A private checkpoint changed its complete file/byte limits.");
}
export function nativeCheckpointOverlay(source: NativePrivateSource, changes: readonly { path: string; file: CheckpointFile | null }[]): NativePrivateSource {
  const entries = new Map(source.entries.map((entry) => [entry.path, entry])), replacements = new Map<string, Buffer>();
  for (const change of changes) {
    const file = change.file;
    if (isPrivateContextPath(change.path)) fail("Checkpoint restoration cannot replace protected or private-context metadata.");
    if (file) {
      const content = Buffer.from(file.content, "base64");
      if (content.toString("base64") !== file.content || content.length !== file.bytes || bytesDigest(content) !== file.digest) fail("A reviewed restore target lost its exact binary bytes.");
      const parts = change.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const path = parts.slice(0, index).join("/"), entry = entries.get(path);
        if (entry && entry.type !== "directory") fail("A reviewed restore path would traverse a retained file or link.");
        if (!entry) entries.set(path, { path, type: "directory", mode: 0o700 });
      }
      if (entries.get(change.path)?.type === "directory" || [...entries.keys()].some((path) => path.startsWith(`${change.path}/`))) {
        fail("A reviewed restore path conflicts with retained unrelated directory contents.");
      }
      entries.set(change.path, { path: change.path, type: "regular", mode: file.mode, digest: file.digest, bytes: file.bytes });
      replacements.set(change.path, content);
    } else {
      if (entries.get(change.path)?.type === "directory") fail("A file restore cannot remove unrelated directory contents.");
      entries.delete(change.path);
    }
  }
  const value = { stage: source.stage, root: source.root, identity: source.identity, entries: ordered(entries.values()) };
  validateNativePrivateEntries(value.entries);
  return { ...value, digest: nativePrivateDigest(value), verify: () => source.verify(),
    read: (path) => replacements.has(path) ? Promise.resolve(replacements.get(path)!) : source.read(path) };
}
