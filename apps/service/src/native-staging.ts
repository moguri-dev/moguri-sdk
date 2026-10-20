import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { MAX_TEXT, MoguriError, isRecord } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, readRegularFile, scopedPath, isProtectedProjectPath } from "./files.ts";
import { assertFolderAccess, type FolderPolicy } from "./project-policy.ts";
import { digest } from "./store.ts";
import { MAX_CONTEXT_FOLDER_FILES, MAX_CONTEXT_TEXT_BYTES } from "./input-limits.ts";

interface DirectoryIdentity { device: string; inode: string }
export interface NativeSourceFile { readonly path: string; readonly text: string; readonly digest: string; readonly bytes: number; readonly mode: number }
export interface NativeSource {
  readonly root: string; readonly identity: DirectoryIdentity; readonly files: readonly NativeSourceFile[];
  readonly policy: FolderPolicy; readonly digest: string;
}
export interface NativeStageOwner { profileId: string; sessionId: string; turnId: string }
export interface NativeStage extends NativeStageOwner {
  readonly parent: string; readonly directory: string; readonly workspace: string; readonly sourceDigest: string; readonly identity: DirectoryIdentity; readonly workspaceIdentity: DirectoryIdentity;
}
function invalid(message: string): never { throw new MoguriError("native_stage", `${message} No user checkout was replaced or published.`, 409); }
const fileName = (path: string): string => {
  if (!path || path.length > 4096 || isAbsolute(path) || /[\\\u0000]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") || isProtectedProjectPath(path)) invalid("Choose an explicit unprotected relative text file.");
  return path;
};
const identity = (value: { dev: bigint; ino: bigint }): DirectoryIdentity => ({ device: String(value.dev), inode: String(value.ino) });
const equalIdentity = (left: DirectoryIdentity, right: DirectoryIdentity) => left.device === right.device && left.inode === right.inode;
const sourceDigest = (source: Omit<NativeSource, "digest">) => digest(JSON.stringify({
  root: source.root, identity: source.identity, policy: source.policy,
  files: source.files.map(({ path, digest, bytes, mode }) => ({ path, digest, bytes, mode })),
}));
function validateSource(source: NativeSource): void {
  if (!isAbsolute(source.root) || source.files.length > MAX_CONTEXT_FOLDER_FILES || sourceDigest(source) !== source.digest) invalid("Native source identity or digest changed.");
  const names = new Set<string>(); let bytes = 0;
  for (const file of source.files) {
    const path = fileName(file.path), key = path.normalize("NFC").toLowerCase();
    if (names.has(key) || file.digest !== digest(file.text) || file.bytes !== Buffer.byteLength(file.text) || file.bytes > MAX_TEXT ||
      !Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) invalid("Native source contains duplicate, changed or unsupported files.");
    names.add(key); bytes += file.bytes;
  }
  if (bytes > MAX_CONTEXT_TEXT_BYTES) invalid("Native source exceeds the exact 200-file/2-MiB text boundary.");
}
async function directory(path: string, owned = false): Promise<DirectoryIdentity> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path ||
    owned && (metadata.uid !== BigInt(process.getuid?.() ?? -1) || metadata.mode & 0o077n)) invalid("The native directory is not canonical or has invalid ownership.");
  return identity(metadata);
}
async function sourceFile(root: string, path: string, policy: FolderPolicy, signal: AbortSignal): Promise<NativeSourceFile> {
  signal.throwIfAborted(); fileName(path);
  await assertFolderAccess(root, path, false, policy);
  const canonical = await scopedPath(root, path), before = await lstat(canonical, { bigint: true });
  const file = await readProjectFile(root, path), after = await lstat(canonical, { bigint: true });
  signal.throwIfAborted();
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.size !== after.size ||
    before.mode !== after.mode || before.isSymbolicLink() || after.isSymbolicLink() || BigInt(file.bytes) !== after.size) invalid("The native source file changed during capture.");
  return { path: file.path, text: file.text, digest: file.digest, bytes: file.bytes, mode: Number(after.mode & 0o777n) };
}
export async function captureNativeSource(root: string, paths: readonly string[], policy: FolderPolicy, signal: AbortSignal): Promise<NativeSource> {
  signal.throwIfAborted();
  if (paths.length > MAX_CONTEXT_FOLDER_FILES) invalid("Native source exceeds the exact 200-file text boundary.");
  const approvedPaths = [...paths].sort(), approvedPolicy = structuredClone(policy);
  const capturedIdentity = await directory(root), files: NativeSourceFile[] = [];
  let bytes = 0;
  for (const path of approvedPaths) {
    const file = await sourceFile(root, path, approvedPolicy, signal); bytes += file.bytes;
    if (bytes > MAX_CONTEXT_TEXT_BYTES) invalid("Native source exceeds the exact 200-file/2-MiB text boundary.");
    files.push(file);
  }
  const source = { root, identity: capturedIdentity, files, policy: approvedPolicy }, captured = { ...source, digest: sourceDigest(source) };
  validateSource(captured); await assertNativeSource(captured, signal);
  return captured;
}
export async function assertNativeSource(requested: NativeSource, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted(); const source = structuredClone(requested); validateSource(source);
  if (!equalIdentity(await directory(source.root), source.identity)) invalid("The source checkout directory was replaced.");
  for (const file of source.files) {
    const current = await sourceFile(source.root, file.path, source.policy, signal);
    if (current.digest !== file.digest || current.mode !== file.mode || current.bytes !== file.bytes) invalid("The reviewed source changed. Preserve the stage and review a new base.");
  }
}
function marker(owner: NativeStageOwner, sourceDigest: string) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner.profileId) || !uuid.test(owner.sessionId) || !uuid.test(owner.turnId) || !/^[a-f0-9]{64}$/.test(sourceDigest)) invalid("Native stage ownership is invalid.");
  return { format: "moguri-native-stage", version: 1, profileId: owner.profileId, sessionId: owner.sessionId, turnId: owner.turnId, sourceDigest };
}
async function write(path: string, text: string, mode: number) {
  const file = await open(path, "wx", mode);
  try { await file.writeFile(text, "utf8"); await file.sync(); } finally { await file.close(); }
}
const overlaps = (parent: string, child: string) => { const path = relative(parent, child); return !isAbsolute(path) && path !== ".." && !path.startsWith("../"); };
export async function materializeNativeStage(parent: string, requestedOwner: NativeStageOwner, requestedSource: NativeSource, signal: AbortSignal, progress?: (copied: number, total: number) => void): Promise<NativeStage> {
  signal.throwIfAborted(); const owner = structuredClone(requestedOwner), source = structuredClone(requestedSource); validateSource(source);
  const ownership = marker(owner, source.digest); await directory(parent, true);
  if (overlaps(source.root, parent) || overlaps(parent, source.root)) invalid("Native staging must be separate from the source checkout.");
  await assertNativeSource(source, signal);
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
    for (const file of source.files) {
      signal.throwIfAborted();
      const target = join(workspace, file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await scopedPath(workspace, file.path, true);
      await write(target, file.text, 0o600 | (file.mode & 0o100));
      progress?.(++copied, source.files.length);
    }
    await assertNativeSource(source, signal);
    return { ...owner, parent, directory: path, workspace, sourceDigest: source.digest, identity: captured, workspaceIdentity: await directory(workspace, true) };
  } catch (error) {
    throw new MoguriError("native_stage_partial", `Native staging is partial at its owned path ${path}. The source was not written and no retry is assumed. ${error instanceof Error ? error.message : "Inspect the owned staging root."}`, 409);
  }
}
export async function inspectNativeStage(stage: NativeStage): Promise<{ workspace: string; identity: DirectoryIdentity }> {
  const expected = marker(stage, stage.sourceDigest), path = join(stage.parent, "native-stages", stage.profileId, stage.turnId);
  if (stage.directory !== path || stage.workspace !== join(path, "workspace")) invalid("This is not the exact owned native stage path.");
  await directory(stage.parent, true);
  if (!equalIdentity(await directory(path, true), stage.identity)) invalid("The owned native stage directory was replaced.");
  const bytes = await readRegularFile(join(path, "owner.json"), 16 * 1024);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return invalid("Native stage ownership metadata is corrupt."); }
  if (!isRecord(value) || JSON.stringify(value) !== JSON.stringify(expected)) invalid("Native stage ownership belongs to another source or profile.");
  const current = await directory(stage.workspace, true);
  if (!equalIdentity(current, stage.workspaceIdentity)) invalid("The private workspace was replaced. Retain rollback evidence; do not reuse this execution binding.");
  return { workspace: stage.workspace, identity: current };
}
