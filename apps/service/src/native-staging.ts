import { chmod, lstat, mkdir, open, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { constants, lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { dirname, isAbsolute, join, relative } from "node:path";
import { MAX_TEXT, MoguriError, isRecord } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, readRegularFile, scopedPath, isProtectedProjectPath } from "./files.ts";
import { assertFolderAccess, type FolderPolicy } from "./project-policy.ts";
import { digest } from "./store.ts";
import { MAX_CONTEXT_FOLDER_FILES, MAX_CONTEXT_TEXT_BYTES } from "./input-limits.ts";
import { repositoryFiles } from "./repository-source.ts";

interface DirectoryIdentity { device: string; inode: string }
export const NATIVE_TREE_MAX_FILES = 20_000, NATIVE_TREE_MAX_BYTES = 256 * 1024 * 1024, NATIVE_TREE_FILE_BYTES = 32 * 1024 * 1024;
export const NATIVE_PRIVATE_METADATA_BYTES = 16 * 1024 * 1024;
export interface NativeSourceFile { readonly path: string; readonly text: string | null; readonly digest: string; readonly bytes: number; readonly mode: number }
export interface NativeSource {
  readonly root: string; readonly identity: DirectoryIdentity; readonly files: readonly NativeSourceFile[];
  readonly policy: FolderPolicy; readonly digest: string;
  readonly capture?: "tree-v1";
}
export interface NativeTextSource extends NativeSource {
  readonly files: readonly (NativeSourceFile & { text: string })[];
  readonly capture?: undefined;
}
export interface NativeStageOwner { profileId: string; sessionId: string; turnId: string }
export interface NativeStage extends NativeStageOwner {
  readonly parent: string; readonly directory: string; readonly workspace: string; readonly sourceDigest: string; readonly identity: DirectoryIdentity; readonly workspaceIdentity: DirectoryIdentity;
}
function invalid(message: string): never { throw new MoguriError("native_stage", `${message} No user checkout was replaced or published.`, 409); }
const fileName = (path: string): string => {
  if (!path || path.length > 4096 || isAbsolute(path) || /[\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") || isProtectedProjectPath(path)) invalid("Choose an explicit unprotected relative text file.");
  return path;
};
const identity = (value: { dev: bigint; ino: bigint }): DirectoryIdentity => ({ device: String(value.dev), inode: String(value.ino) });
const equalIdentity = (left: DirectoryIdentity, right: DirectoryIdentity) => left.device === right.device && left.inode === right.inode;
const sourceDigest = (source: Omit<NativeSource, "digest">) => digest(JSON.stringify({
  root: source.root, identity: source.identity, policy: source.policy,
  files: source.files.map(({ path, digest, bytes, mode }) => ({ path, digest, bytes, mode })),
  ...(source.capture ? { capture: source.capture } : {}),
}));
function validateSource(source: NativeSource): void {
  const tree = source.capture === "tree-v1";
  if (!isAbsolute(source.root) || source.files.length > (tree ? NATIVE_TREE_MAX_FILES : MAX_CONTEXT_FOLDER_FILES) || sourceDigest(source) !== source.digest) invalid("Native source identity or digest changed.");
  const names = new Set<string>(); let bytes = 0;
  for (const file of source.files) {
    const path = fileName(file.path), key = path.normalize("NFC").toLowerCase();
    if (names.has(key) || !/^[a-f0-9]{64}$/.test(file.digest) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      (tree ? file.text !== null || file.bytes > NATIVE_TREE_FILE_BYTES : file.text === null || file.digest !== digest(file.text) || file.bytes !== Buffer.byteLength(file.text) || file.bytes > MAX_TEXT) ||
      !Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) invalid("Native source contains duplicate, changed or unsupported files.");
    names.add(key); bytes += file.bytes;
  }
  if (bytes > (tree ? NATIVE_TREE_MAX_BYTES : MAX_CONTEXT_TEXT_BYTES)) invalid(tree ?
    "Automatic native source exceeds its complete 20,000-file/256-MiB regular-file boundary. No subset was silently selected." :
    "Native source exceeds the exact 200-file/2-MiB text boundary.");
}
async function directory(path: string, owned = false): Promise<DirectoryIdentity> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path ||
    owned && (metadata.uid !== BigInt(process.getuid?.() ?? -1) || metadata.mode & 0o077n)) invalid("The native directory is not canonical or has invalid ownership.");
  return identity(metadata);
}
async function sourceFile(root: string, path: string, policy: FolderPolicy, signal: AbortSignal, tree = false): Promise<NativeSourceFile> {
  signal.throwIfAborted(); fileName(path);
  await assertFolderAccess(root, path, false, policy);
  const canonical = await scopedPath(root, path), before = await lstat(canonical, { bigint: true });
  if (!before.isFile() || before.size > BigInt(tree ? NATIVE_TREE_FILE_BYTES : MAX_TEXT)) invalid("Native source contains an unsupported or oversized regular file; no content was truncated.");
  const file = tree ? await (async () => {
    const content = await readRegularFile(canonical, Number(before.size));
    return { path, text: null, digest: createHash("sha256").update(content).digest("hex"), bytes: content.length };
  })() : await readProjectFile(root, path);
  const after = await lstat(canonical, { bigint: true });
  signal.throwIfAborted();
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.size !== after.size ||
    before.mode !== after.mode || before.isSymbolicLink() || after.isSymbolicLink() || BigInt(file.bytes) !== after.size) invalid("The native source file changed during capture.");
  return { path: file.path, text: file.text, digest: file.digest, bytes: file.bytes, mode: Number(after.mode & 0o777n) };
}
export async function captureNativeSource(root: string, paths: readonly string[], policy: FolderPolicy, signal: AbortSignal): Promise<NativeTextSource> {
  signal.throwIfAborted();
  if (paths.length > MAX_CONTEXT_FOLDER_FILES) invalid("Native source exceeds the exact 200-file text boundary.");
  const approvedPaths = [...paths].sort(), approvedPolicy = structuredClone(policy);
  const capturedIdentity = await directory(root), files: Array<NativeSourceFile & { text: string }> = [];
  let bytes = 0;
  for (const path of approvedPaths) {
    const file = await sourceFile(root, path, approvedPolicy, signal); bytes += file.bytes;
    if (file.text === null) invalid("Reviewed text capture unexpectedly contained a metadata-only file.");
    if (bytes > MAX_CONTEXT_TEXT_BYTES) invalid("Native source exceeds the exact 200-file/2-MiB text boundary.");
    files.push({ ...file, text: file.text });
  }
  const source = { root, identity: capturedIdentity, files, policy: approvedPolicy }, captured = { ...source, digest: sourceDigest(source) };
  validateSource(captured); await assertNativeSource(captured, signal);
  return captured;
}
export async function captureNativeTree(root: string, requestedPolicy: FolderPolicy, signal: AbortSignal): Promise<NativeSource> {
  signal.throwIfAborted();
  const policy = structuredClone(requestedPolicy), capturedIdentity = await directory(root);
  const candidates = await repositoryFiles(root, NATIVE_TREE_MAX_FILES + 1, signal, policy.denied);
  if (candidates.length > NATIVE_TREE_MAX_FILES) invalid("Automatic native source exceeds 20,000 regular files. No partial project was selected.");
  const paths = candidates.filter((path) => !isProtectedProjectPath(path)).sort();
  const files: NativeSourceFile[] = [];
  let bytes = 0;
  for (const path of paths) {
    const file = await sourceFile(root, path, policy, signal, true);
    bytes += file.bytes;
    if (bytes > NATIVE_TREE_MAX_BYTES) invalid("Automatic native source exceeds 256 MiB. No partial project was selected.");
    files.push(file);
  }
  const source = { root, identity: capturedIdentity, files, policy, capture: "tree-v1" as const };
  const captured = { ...source, digest: sourceDigest(source) };
  validateSource(captured); await assertNativeSource(captured, signal);
  return captured;
}
export async function assertNativeSource(requested: NativeSource, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted(); const source = structuredClone(requested); validateSource(source);
  if (!equalIdentity(await directory(source.root), source.identity)) invalid("The source checkout directory was replaced.");
  for (const file of source.files) {
    const current = await sourceFile(source.root, file.path, source.policy, signal, source.capture === "tree-v1");
    if (current.digest !== file.digest || current.mode !== file.mode || current.bytes !== file.bytes) invalid("The reviewed source changed. Preserve the stage and review a new base.");
  }
  if (source.capture === "tree-v1") {
    const paths = (await repositoryFiles(source.root, NATIVE_TREE_MAX_FILES + 1, signal, source.policy.denied)).filter((path) => !isProtectedProjectPath(path)).sort();
    if (JSON.stringify(paths) !== JSON.stringify(source.files.map((file) => file.path))) invalid("The automatic source file set changed during capture. No mixed or partial tree was admitted.");
  }
}
function marker(owner: NativeStageOwner, sourceDigest: string) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner.profileId) || !uuid.test(owner.sessionId) || !uuid.test(owner.turnId) || !/^[a-f0-9]{64}$/.test(sourceDigest)) invalid("Native stage ownership is invalid.");
  return { format: "moguri-native-stage", version: 1, profileId: owner.profileId, sessionId: owner.sessionId, turnId: owner.turnId, sourceDigest };
}
async function write(path: string, text: string | Uint8Array, mode: number) {
  const file = await open(path, "wx", mode);
  try { await file.writeFile(text, typeof text === "string" ? "utf8" : undefined); await file.sync(); } finally { await file.close(); }
}
const overlaps = (parent: string, child: string) => { const path = relative(parent, child); return !isAbsolute(path) && path !== ".." && !path.startsWith("../"); };
export interface NativeRepositorySource { projectId: string; directory: string; source: NativeSource }
export function nativeRepositoryDirectory(projectId: string): string {
  if (!projectId || projectId.length > 128 || !projectId.isWellFormed() || /[\0\r\n]/.test(projectId)) invalid("Native repository mapping needs its exact captured project ID.");
  return `repositories/${digest(`moguri-native-repository-v1\0${projectId}`)}`;
}
export function nativeCompositeDigest(repositories: readonly NativeRepositorySource[]): string {
  if (!repositories.length || repositories.length > 1000) invalid("Native group mapping needs one complete bounded captured repository set.");
  const ids = new Set<string>(), directories = new Set<string>();
  let files = 0, bytes = 0;
  for (const repository of repositories) {
    if (repository.directory !== nativeRepositoryDirectory(repository.projectId)) invalid("Native repository directory mapping changed.");
    if (ids.has(repository.projectId) || directories.has(repository.directory)) invalid("Native group mapping contains duplicate repositories.");
    ids.add(repository.projectId); directories.add(repository.directory); validateSource(repository.source);
    files += repository.source.files.length; bytes += repository.source.files.reduce((sum, file) => sum + file.bytes, 0);
    if (files > NATIVE_TREE_MAX_FILES || bytes > NATIVE_TREE_MAX_BYTES) invalid("Native group aggregate exceeds the complete 20,000-file/256-MiB boundary. No member or subset was silently omitted.");
  }
  for (const [index, repository] of repositories.entries()) for (const other of repositories.slice(index + 1)) {
    if (equalIdentity(repository.source.identity, other.source.identity) || overlaps(repository.source.root, other.source.root) || overlaps(other.source.root, repository.source.root)) {
      invalid("Captured native group roots overlap or alias the same original directory.");
    }
  }
  return digest(`moguri-native-group-v1\0${JSON.stringify([...repositories].sort((a, b) => a.projectId.localeCompare(b.projectId))
    .map(({ projectId, directory, source }) => ({ projectId, directory, sourceDigest: source.digest })))}`);
}
export async function materializeNativeStage(parent: string, requestedOwner: NativeStageOwner, requestedSource: NativeSource, signal: AbortSignal, progress?: (copied: number, total: number) => void): Promise<NativeStage> {
  signal.throwIfAborted(); const owner = structuredClone(requestedOwner), source = structuredClone(requestedSource); validateSource(source);
  return materializeSources(parent, owner, [{ source, directory: "" }], source.digest, signal, progress);
}
export async function materializeNativeGroup(parent: string, requestedOwner: NativeStageOwner, requested: readonly NativeRepositorySource[], signal: AbortSignal, progress?: (copied: number, total: number) => void): Promise<NativeStage> {
  signal.throwIfAborted(); const owner = structuredClone(requestedOwner), repositories = structuredClone(requested);
  return materializeSources(parent, owner, repositories, nativeCompositeDigest(repositories), signal, progress);
}
async function materializeSources(parent: string, owner: NativeStageOwner, sources: readonly { source: NativeSource; directory: string }[], capturedDigest: string,
  signal: AbortSignal, progress?: (copied: number, total: number) => void): Promise<NativeStage> {
  const ownership = marker(owner, capturedDigest); await directory(parent, true);
  for (const { source } of sources) {
    if (overlaps(source.root, parent) || overlaps(parent, source.root)) invalid("Native staging must be separate from the source checkout for every captured repository.");
    await assertNativeSource(source, signal);
  }
  let stageParent = parent;
  for (const part of ["native-stages", owner.profileId]) {
    stageParent = join(stageParent, part);
    try { await mkdir(stageParent, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    await directory(stageParent, true);
  }
  const path = join(stageParent, owner.turnId), workspace = join(path, "workspace");
  await mkdir(path, { mode: 0o700 });
  try {
    const captured = await directory(path, true);
    await write(join(path, "owner.json"), JSON.stringify(ownership), 0o600);
    await mkdir(workspace, { mode: 0o700 });
    let copied = 0;
    const total = sources.reduce((sum, entry) => sum + entry.source.files.length, 0);
    for (const { source, directory } of sources) {
      if (directory) {
        await mkdir(join(workspace, directory), { recursive: true, mode: 0o700 });
        await scopedPath(workspace, directory);
      }
      for (const file of source.files) {
        signal.throwIfAborted();
        const path = directory ? `${directory}/${file.path}` : file.path, target = join(workspace, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await scopedPath(workspace, path, true);
        const content = file.text ?? await readRegularFile(await scopedPath(source.root, file.path), file.bytes);
        const bytes = typeof content === "string" ? Buffer.from(content) : content;
        if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.digest) invalid("The native source changed during copying.");
        await write(target, content, 0o600 | (file.mode & 0o100));
        progress?.(++copied, total);
      }
    }
    for (const { source } of sources) await assertNativeSource(source, signal);
    return { ...owner, parent, directory: path, workspace, sourceDigest: capturedDigest, identity: captured, workspaceIdentity: await directory(workspace, true) };
  } catch (error) {
    throw new MoguriError("native_stage_partial", `Native staging is partial at its owned path ${path}. The source was not written and no retry is assumed. ${error instanceof Error ? error.message : "Inspect the owned staging root."}`, 409);
  }
}
export async function inspectNativeStageContainer(stage: NativeStage): Promise<void> {
  const expected = marker(stage, stage.sourceDigest), path = join(stage.parent, "native-stages", stage.profileId, stage.turnId);
  if (stage.directory !== path || stage.workspace !== join(path, "workspace")) invalid("This is not the exact owned native stage path.");
  await directory(stage.parent, true);
  if (!equalIdentity(await directory(path, true), stage.identity)) invalid("The owned native stage directory was replaced.");
  const bytes = await readRegularFile(join(path, "owner.json"), 16 * 1024);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return invalid("Native stage ownership metadata is corrupt."); }
  if (!isRecord(value) || JSON.stringify(value) !== JSON.stringify(expected)) invalid("Native stage ownership belongs to another source or profile.");
}
export async function inspectNativeStage(stage: NativeStage): Promise<{ workspace: string; identity: DirectoryIdentity }> {
  await inspectNativeStageContainer(stage);
  const current = await directory(stage.workspace, true);
  if (!equalIdentity(current, stage.workspaceIdentity)) invalid("The private workspace was replaced. Retain rollback evidence; do not reuse this execution binding.");
  return { workspace: stage.workspace, identity: current };
}
export function assertNativeWorkspaceIdentity(stage: NativeStage): void {
  const metadata = lstatSync(stage.workspace, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(stage.workspace) !== stage.workspace ||
    metadata.uid !== BigInt(process.getuid?.() ?? -1) || metadata.mode & 0o077n ||
    !equalIdentity(identity(metadata), stage.workspaceIdentity)) invalid("The private workspace was replaced or changed ownership. Retain its actual after-state; prepare a newly reviewed stage before another turn.");
}

export interface NativePrivateEntry {
  path: string; type: "directory" | "regular" | "symlink"; mode: number;
  digest?: string; bytes?: number; target?: string;
  identity?: { device: string; inode: string; mtimeNs: string; ctimeNs: string };
}
export interface NativePrivateSource {
  readonly stage: NativeStage; readonly root: string; readonly identity: DirectoryIdentity; readonly entries: readonly NativePrivateEntry[]; readonly digest: string;
  read(path: string): Promise<Buffer>; verify(): Promise<void>;
}
const privateName = (path: string) => {
  if (!path || path.length > 4096 || !path.isWellFormed() || isAbsolute(path) || /[\\\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")) invalid("A private snapshot has an unsafe path.");
  return path;
};
export const nativePrivateVersion = (entry: NativePrivateEntry | undefined): string => entry ?
  JSON.stringify([entry.type, entry.mode, entry.digest ?? null, entry.bytes ?? null, entry.target ?? null]) : "absent";
export const nativePrivateDigest = (source: Pick<NativePrivateSource, "root" | "identity" | "entries">): string =>
  digest(JSON.stringify({ format: "moguri-native-private-tree", version: 1, root: source.root, identity: source.identity, entries: source.entries }));
const privateBytesDigest = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");
export function validateNativePrivateEntries(entries: readonly NativePrivateEntry[]): void {
  const names = new Set<string>(), paths = new Map<string, NativePrivateEntry>();
  let bytes = 0, files = 0, metadata = 0;
  if (entries.length > 100_000) invalid("The complete private snapshot exceeds 100,000 entries.");
  for (const entry of entries) {
    metadata += Buffer.byteLength(JSON.stringify(entry));
    if (metadata > NATIVE_PRIVATE_METADATA_BYTES) invalid("The complete private metadata exceeds 16 MiB. No paths or dependency/Git entries were truncated.");
    const path = privateName(entry.path), key = path.normalize("NFC").toLowerCase();
    if (names.has(key) || !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 ||
      path.split("/").length > 64) invalid("The complete private snapshot has duplicate paths, unsupported modes or more than 64 directory levels.");
    names.add(key); paths.set(path, entry);
    if (entry.type === "regular") {
      if (!/^[a-f0-9]{64}$/.test(entry.digest ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes! < 0 ||
        entry.bytes! > NATIVE_TREE_FILE_BYTES) invalid("A private regular file exceeds its exact 32-MiB byte boundary.");
      bytes += entry.bytes!; files++;
    } else if (entry.type === "symlink") {
      if (typeof entry.target !== "string" || !entry.target.isWellFormed() || entry.target.includes("\0") ||
        Buffer.byteLength(entry.target) > 4096) invalid("A private symbolic link has an unsupported target.");
      files++;
    } else if (entry.type !== "directory") invalid("A private snapshot contains an unsupported special file.");
  }
  if (files > NATIVE_TREE_MAX_FILES || bytes > NATIVE_TREE_MAX_BYTES) invalid("The complete private snapshot exceeds 20,000 files or 256 MiB. No dependencies or Git data were silently omitted.");
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index++) if (paths.get(parts.slice(0, index).join("/"))?.type !== "directory") {
      invalid("A private snapshot is missing a directory or traverses a non-directory.");
    }
  }
}
async function privateFile(root: string, entry: NativePrivateEntry, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const path = join(root, privateName(entry.path));
  if (await realpath(path) !== path) invalid("A private regular file acquired a filesystem alias.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(NATIVE_TREE_FILE_BYTES)) invalid("A private snapshot file is not bounded and regular.");
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      signal.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(64 * 1024, NATIVE_TREE_FILE_BYTES + 1 - size));
      const result = await file.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      chunks.push(buffer.subarray(0, result.bytesRead)); size += result.bytesRead;
      if (size > NATIVE_TREE_FILE_BYTES) invalid("A private snapshot file grew beyond its exact byte limit.");
    }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    const version = (value: typeof before) => JSON.stringify([String(value.dev), String(value.ino), String(value.size),
      String(value.mtimeNs), String(value.ctimeNs), String(value.mode)]);
    if (version(before) !== version(after) || version(after) !== version(current) || BigInt(size) !== after.size ||
      await realpath(path) !== path) invalid("Private bytes changed during the complete-file read.");
    if (entry.identity && (entry.identity.device !== String(after.dev) || entry.identity.inode !== String(after.ino) ||
      entry.identity.mtimeNs !== String(after.mtimeNs) || entry.identity.ctimeNs !== String(after.ctimeNs))) invalid("A reviewed private inode changed.");
    const content = Buffer.concat(chunks, size);
    if (entry.digest !== undefined && (privateBytesDigest(content) !== entry.digest || size !== entry.bytes || Number(after.mode & 0o777n) !== entry.mode)) {
      invalid("The reviewed private file bytes or mode changed.");
    }
    return content;
  } finally { await file.close(); }
}
export async function captureNativePrivateTree(stage: NativeStage, signal: AbortSignal, check: () => void = () => {},
  allowReplacedWorkspace = false): Promise<NativePrivateSource> {
  const inspect = async () => {
    check(); signal.throwIfAborted(); await inspectNativeStageContainer(stage);
    const captured = await directory(stage.workspace, true);
    if (!allowReplacedWorkspace && !equalIdentity(captured, stage.workspaceIdentity)) invalid("The exact private workspace inode changed without a qualified rollback.");
    return captured;
  };
  const capturedIdentity = await inspect(), entries: NativePrivateEntry[] = [], directories: Array<{ path: string; version: string }> = [];
  let metadataBytes = 0;
  const append = (entry: NativePrivateEntry) => {
    metadataBytes += Buffer.byteLength(JSON.stringify(entry));
    if (metadataBytes > NATIVE_PRIVATE_METADATA_BYTES) invalid("The complete private metadata exceeds 16 MiB. No path set was truncated.");
    entries.push(entry);
  };
  const metadataVersion = (value: BigIntStats) =>
    JSON.stringify([String(value.dev), String(value.ino), String(value.mode), String(value.mtimeNs), String(value.ctimeNs)]);
  const walk = async (directory: string, depth: number) => {
    check(); signal.throwIfAborted();
    if (depth > 64) invalid("The complete private tree exceeds 64 directory levels.");
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || await realpath(directory) !== directory) invalid("A private snapshot directory acquired an alias.");
    directories.push({ path: directory, version: metadataVersion(before) });
    for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      check(); signal.throwIfAborted();
      if (entries.length >= 100_000) invalid("The complete private tree exceeds 100,000 entries.");
      const absolute = join(directory, child.name), path = privateName(relative(stage.workspace, absolute)), metadata = await lstat(absolute, { bigint: true });
      const entry: NativePrivateEntry = { path, type: metadata.isDirectory() ? "directory" : metadata.isFile() ? "regular" : "symlink",
        mode: Number(metadata.mode & 0o777n), identity: { device: String(metadata.dev), inode: String(metadata.ino),
          mtimeNs: String(metadata.mtimeNs), ctimeNs: String(metadata.ctimeNs) } };
      if (metadata.isSymbolicLink()) {
        const target = await readlink(absolute, { encoding: "buffer" });
        if (!isUtf8(target) || target.includes(0)) invalid("A private symbolic link target is not lossless UTF-8.");
        entry.target = target.toString("utf8");
      }
      else if (metadata.isDirectory()) { append(entry); await walk(absolute, depth + 1); continue; }
      else if (metadata.isFile()) {
        const content = await privateFile(stage.workspace, entry, signal);
        entry.digest = privateBytesDigest(content); entry.bytes = content.length;
      } else invalid("A complete private snapshot contains an unsupported device, socket or special file.");
      append(entry);
    }
  };
  await walk(stage.workspace, 0);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  validateNativePrivateEntries(entries);
  const source = { stage: structuredClone(stage), root: stage.workspace, identity: capturedIdentity, entries };
  const verify = async () => {
    if (!equalIdentity(await inspect(), capturedIdentity)) invalid("The private workspace changed during snapshot capture.");
    for (const saved of directories) {
      const metadata = await lstat(saved.path, { bigint: true });
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadataVersion(metadata) !== saved.version ||
        await realpath(saved.path) !== saved.path) invalid("The complete private file set changed during capture.");
    }
    for (const entry of entries) {
      check(); signal.throwIfAborted();
      if (entry.type === "regular") await privateFile(source.root, entry, signal);
      else {
        const metadata = await lstat(join(source.root, entry.path), { bigint: true });
        if (String(metadata.dev) !== entry.identity!.device || String(metadata.ino) !== entry.identity!.inode ||
          String(metadata.mtimeNs) !== entry.identity!.mtimeNs || String(metadata.ctimeNs) !== entry.identity!.ctimeNs ||
          Number(metadata.mode & 0o777n) !== entry.mode ||
          entry.type === "symlink" && (!metadata.isSymbolicLink() || await readlink(join(source.root, entry.path)) !== entry.target)) {
          invalid("A private snapshot path changed during complete-tree verification.");
        }
      }
    }
    if (!equalIdentity(await inspect(), capturedIdentity)) invalid("The private workspace changed after complete-tree verification.");
  };
  await verify();
  return { ...source, digest: nativePrivateDigest(source), verify,
    read: async (path) => {
      const entry = entries.find((entry) => entry.path === path);
      if (entry?.type !== "regular") invalid("The exact private regular file is unavailable.");
      return privateFile(source.root, entry, signal);
    } };
}
export async function materializeNativePrivateStage(parent: string, requestedOwner: NativeStageOwner, source: NativePrivateSource,
  signal: AbortSignal, check: () => void): Promise<NativeStage> {
  validateNativePrivateEntries(source.entries);
  source = { stage: structuredClone(source.stage), root: source.root, identity: structuredClone(source.identity),
    entries: structuredClone(source.entries), digest: source.digest, read: source.read.bind(source), verify: source.verify.bind(source) };
  const owner = structuredClone(requestedOwner), ownership = marker(owner, source.digest);
  if (source.root !== source.stage.workspace || source.stage.profileId !== owner.profileId || source.stage.sessionId !== owner.sessionId ||
    nativePrivateDigest(source) !== source.digest) invalid("Private cloning requires the exact same profile/session-owned stage, not a source checkout.");
  validateNativePrivateEntries(source.entries); await directory(parent, true);
  await inspectNativeStageContainer(source.stage); await source.verify();
  let stageParent = parent;
  for (const part of ["native-stages", owner.profileId]) {
    stageParent = join(stageParent, part);
    try { await mkdir(stageParent, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    await directory(stageParent, true);
  }
  const path = join(stageParent, owner.turnId), workspace = join(path, "workspace");
  check(); signal.throwIfAborted(); await mkdir(path, { mode: 0o700 });
  try {
    const captured = await directory(path, true);
    await write(join(path, "owner.json"), JSON.stringify(ownership), 0o600); await mkdir(workspace, { mode: 0o700 });
    for (const entry of source.entries.filter((entry) => entry.type === "directory").sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
      check(); signal.throwIfAborted(); await mkdir(join(workspace, entry.path), { mode: 0o700 });
    }
    for (const entry of source.entries.filter((entry) => entry.type !== "directory")) {
      check(); signal.throwIfAborted();
      if (entry.type === "symlink") await symlink(entry.target!, join(workspace, entry.path));
      else {
        const content = await source.read(entry.path);
        if (content.length !== entry.bytes || privateBytesDigest(content) !== entry.digest) invalid("The exact private clone source changed.");
        const target = await open(join(workspace, entry.path), "wx", 0o600);
        try { await target.writeFile(content); await target.chmod(entry.mode); await target.sync(); } finally { await target.close(); }
      }
    }
    for (const entry of source.entries.filter((entry) => entry.type === "directory").sort((a, b) => b.path.split("/").length - a.path.split("/").length)) {
      check(); signal.throwIfAborted(); await chmod(join(workspace, entry.path), entry.mode);
    }
    for (const directory of [...source.entries.filter((entry) => entry.type === "directory").map((entry) => join(workspace, entry.path)).reverse(),
      workspace, path, stageParent, dirname(stageParent), parent, dirname(parent)]) {
      check(); signal.throwIfAborted();
      const handle = await open(directory, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    }
    await source.verify(); check(); signal.throwIfAborted();
    const stage = { ...owner, parent, directory: path, workspace, sourceDigest: source.digest, identity: captured, workspaceIdentity: await directory(workspace, true) };
    const copied = await captureNativePrivateTree(stage, signal, check);
    if (JSON.stringify(copied.entries.map(nativePrivateVersion)) !== JSON.stringify(source.entries.map(nativePrivateVersion)) ||
      JSON.stringify(copied.entries.map((entry) => entry.path)) !== JSON.stringify(source.entries.map((entry) => entry.path))) invalid("The complete private clone differs from its exact bytes/modes/file set.");
    await source.verify(); check(); signal.throwIfAborted(); return stage;
  } catch (error) {
    throw new MoguriError("native_stage_partial", `Private cloning is partial at its owned path ${path}. All old stages and copied files remain retained; nothing was rebound or replayed. ${error instanceof Error ? error.message : "Inspect the original intent."}`, 409);
  }
}
