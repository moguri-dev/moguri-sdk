import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import {
  CHECKPOINT_FILE_BYTES, CHECKPOINT_WORKSPACE_BYTES, CheckpointRestorePlanSchema, CheckpointRestoreResultSchema,
  CheckpointWorkspaceSchema, MoguriError, type CheckpointFile, type CheckpointRestorePlan, type CheckpointRestoreResult,
  type CheckpointWorkspace, type ProjectSettings,
} from "../../../packages/protocol/src/index.ts";
import { checkpointWorkspace } from "./checkpoint-files.ts";
import { bytesDigest, isProtectedProjectPath, readRegularFileSync, scopedPathSync } from "./files.ts";
import { assertFolderName, folderPolicy } from "./project-policy.ts";
import { sourceRootSync } from "./repository-source.ts";
import { publishRewindFile } from "./rewind-files.ts";
import { frameDigest, MAX_WORKER_FRAME } from "./worker-wire.ts";
import type { WorkspaceRewindInspection, WorkspaceRewindOperation } from "./worker-protocol.ts";

export const REMOTE_REWIND_OPERATION_BYTES = 24 * 1024 * 1024;
export const REMOTE_REWIND_INSPECTION_BYTES = 8 * 1024 * 1024;
type FileResult = CheckpointRestoreResult["files"][number];
type Descriptor = NonNullable<CheckpointRestorePlan["files"][number]["current"]>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const pathKey = (path: string) => process.platform === "darwin" ? path.normalize("NFC").toLowerCase() : path;
const relativePath = (path: string) => path.isWellFormed() && !/[\u0000-\u001f\u007f\\]/.test(path) &&
  !path.startsWith("/") && !path.split("/").some((part) => !part || part === "." || part === "..");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const descriptor = ({ content: _content, ...file }: CheckpointFile): Descriptor => file;
const absent = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const fail = (code: string, message: string): never => { throw new MoguriError(code, `${message} Original bytes/history are preserved; no replay, reset or Local fallback.`, 409); };

export function requireRemoteCheckpointIdentity(file: Pick<CheckpointFile, "identity">): NonNullable<CheckpointFile["identity"]> {
  if (!file.identity) return fail("rewind_identity", "Remote checkpoint files require their genuine OS identity; a signed native snapshot cannot substitute it.");
  return file.identity;
}

export function verifyRemoteCheckpointWorkspace(value: CheckpointWorkspace, root: string): CheckpointWorkspace {
  if (!Value.Check(CheckpointWorkspaceSchema, value) || value.roots.length !== 1 || value.boundary ||
    value.roots[0]!.binding.root !== root || value.roots[0]!.repositoryId !== null || value.roots[0]!.key !== undefined) {
    return fail("rewind_capture", "The complete raw peer capture changed its exact root or acquired controller provenance.");
  }
  const { digest: expected, ...source } = value, captured = value.roots[0]!, paths = new Set<string>();
  let bytes = 0;
  for (const file of captured.files) {
    requireRemoteCheckpointIdentity(file);
    const key = pathKey(file.path), content = Buffer.from(file.content, "base64");
    if (!relativePath(file.path) || isProtectedProjectPath(file.path) || paths.has(key) || content.toString("base64") !== file.content ||
      content.length !== file.bytes || bytesDigest(content) !== file.digest) return fail("rewind_capture", "A peer file is aliased, duplicated, incomplete or has different bytes.");
    paths.add(key); bytes += file.bytes;
  }
  if (!/^[0-9]{1,40}$/.test(captured.binding.device) || !/^[0-9]{1,40}$/.test(captured.binding.inode) ||
    bytes !== value.bytes || frameDigest(source) !== expected || captured.excluded.length > 10000 ||
    captured.excluded.some((path) => !relativePath(path)) || Buffer.byteLength(JSON.stringify(value)) + 4096 > MAX_WORKER_FRAME) {
    return fail("rewind_capture", "The complete bounded peer manifest, root identity or excluded-path diagnostics failed verification.");
  }
  return value;
}

export function validateRemoteRewindPlan(plan: CheckpointRestorePlan, root: string, settings: ProjectSettings): void {
  if (!Value.Check(CheckpointRestorePlanSchema, plan) || !uuid.test(plan.operationId) || plan.root.root !== root ||
    !/^[0-9]{1,40}$/.test(plan.root.device) || !/^[0-9]{1,40}$/.test(plan.root.inode)) {
    return fail("rewind_plan", "Restoration needs its exact bounded original operation and canonical peer root.");
  }
  const paths = new Set<string>(), policy = folderPolicy(settings);
  let bytes = 0;
  for (const file of plan.files) {
    if (file.current) requireRemoteCheckpointIdentity(file.current);
    if (file.target) requireRemoteCheckpointIdentity(file.target);
    const key = pathKey(file.path);
    if (!relativePath(file.path) || isProtectedProjectPath(file.path) || paths.has(key) ||
      file.current && file.current.path !== file.path || file.target && file.target.path !== file.path) {
      return fail("rewind_path", "The reviewed file set contains a protected, duplicate or noncanonical path.");
    }
    assertFolderName(file.path, file.choice === "restore-checkpoint", policy);
    if (file.current && Buffer.byteLength(join(root, ".moguri", "rewinds", plan.operationId, `${paths.size}.displaced`)) > 4096) {
      return fail("rewind_path", "The complete original displaced path exceeds its receipt bound.");
    }
    paths.add(key);
    if (file.target) {
      const content = Buffer.from(file.target.content, "base64");
      bytes += content.length;
      if (content.toString("base64") !== file.target.content || content.length !== file.target.bytes ||
        bytesDigest(content) !== file.target.digest) return fail("rewind_source", "The full checkpoint target bytes failed their original digest.");
    }
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) if (paths.has(parts.slice(0, index).join("/"))) {
      return fail("rewind_path", "A reviewed file aliases another destination's parent directory.");
    }
  }
  if (bytes > CHECKPOINT_WORKSPACE_BYTES) return fail("rewind_limit", "Complete restoration exceeds its 16 MiB byte bound.");
}

export function validateRemoteRewindOperation(operation: WorkspaceRewindOperation): void {
  validateRemoteRewindPlan(operation.plan, operation.plan.root.root, operation.settings);
  const operationBytes = Buffer.byteLength(JSON.stringify(operation));
  // Original frames stay on the peer after completion, so reserve the complete journal, not just one wire frame.
  const receiptBytes = operation.plan.files.reduce((bytes, file, index) => {
    const backup = file.current ? join(operation.plan.root.root, ".moguri", "rewinds", operation.operationId, `${index}.displaced`) : null;
    return bytes + 4096 + 4 * Buffer.byteLength(file.path) + 3 * Buffer.byteLength(backup ?? "");
  }, 64 * 1024);
  if (operation.operationId !== operation.plan.operationId || operationBytes > REMOTE_REWIND_OPERATION_BYTES ||
    operationBytes + receiptBytes > MAX_WORKER_FRAME - 1024 * 1024) return fail("rewind_limit", "The complete original operation and all retained receipts exceed their explicit journal bound.");
}

function snapshot(root: string, settings: ProjectSettings, plan?: CheckpointRestorePlan): CheckpointWorkspace {
  const binding = sourceRootSync(root);
  if (plan && !same(binding, plan.root)) return fail("rewind_root", "The original root device/inode changed.");
  const value = verifyRemoteCheckpointWorkspace(checkpointWorkspace([{ binding, repositoryId: null, denied: settings.deniedFolders }]), root);
  if (plan && !same(value.roots[0]!.git, plan.expectedGit)) return fail("rewind_git", "Current Git HEAD/index differs from the exact reviewed intent.");
  return value;
}

function checkPrivateParents(root: string, operationId: string): boolean {
  let directory = root;
  for (const part of [".moguri", "rewinds", operationId]) {
    directory = join(directory, part);
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
        stat.mode & 0o077 || realpathSync(directory) !== directory) return fail("rewind_backup", "An original private backup parent was replaced or is not owned.");
    } catch (error) { if (absent(error)) return false; throw error; }
  }
  return true;
}

function backupFile(root: string, operationId: string, index: number): WorkspaceRewindInspection["files"][number]["backup"] {
  if (!checkPrivateParents(root, operationId)) return null;
  const path = join(root, ".moguri", "rewinds", operationId, `${index}.displaced`);
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) return fail("rewind_backup", "The displaced path is not its original regular inode.");
    const bytes = readRegularFileSync(path, CHECKPOINT_FILE_BYTES), after = lstatSync(path, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      return fail("rewind_backup", "The displaced inode changed during complete inspection.");
    }
    return { path, file: { path: `${index}.displaced`, digest: bytesDigest(bytes), bytes: bytes.length, mode: Number(after.mode & 0o777n),
      identity: { device: String(after.dev), inode: String(after.ino), mtimeNs: String(after.mtimeNs), ctimeNs: String(after.ctimeNs) } } };
  } catch (error) { if (absent(error)) return null; throw error; }
}

function originalBackup(plan: CheckpointRestorePlan, index: number, result: FileResult) {
  const file = plan.files[index]!, backup = backupFile(plan.root.root, plan.operationId, index);
  if (file.current && file.choice === "restore-checkpoint") {
    const currentIdentity = requireRemoteCheckpointIdentity(file.current), backupIdentity = backup ? requireRemoteCheckpointIdentity(backup.file) : null;
    if (!backup || !backupIdentity || backup.path !== result.backup || backupIdentity.device !== currentIdentity.device ||
      backupIdentity.inode !== currentIdentity.inode || backup.file.digest !== file.current.digest ||
      backup.file.bytes !== file.current.bytes || backup.file.mode !== file.current.mode) {
      return fail("rewind_conflict", "A late writer changed the original displaced inode; its complete actual bytes remain in the private backup.");
    }
  } else if (backup || result.backup !== null) return fail("rewind_backup", "An unreviewed backup appeared for a path with no displaced original.");
  return backup;
}

function currentFile(workspace: CheckpointWorkspace, file: CheckpointRestorePlan["files"][number]): CheckpointFile | undefined {
  const root = workspace.roots[0]!, current = root.files.find((value) => pathKey(value.path) === pathKey(file.path));
  if (!same(current ? descriptor(current) : null, file.current) ||
    root.excluded.some((path) => pathKey(file.path) === pathKey(path) || pathKey(file.path).startsWith(`${pathKey(path)}/`))) {
    return fail("rewind_conflict", "The actual file identity, mode, bytes or exclusion policy changed after review.");
  }
  return current;
}

export async function executeWorkspaceRewind(root: string, operation: WorkspaceRewindOperation, signal: AbortSignal,
  boundary: (index: number, phase: "moving" | "observed", result?: FileResult) => Promise<void>): Promise<CheckpointRestoreResult> {
  validateRemoteRewindOperation(operation); signal.throwIfAborted();
  const { plan, settings } = operation, initial = snapshot(root, settings, plan);
  if (initial.digest !== plan.expectedWorkspaceDigest) return fail("rewind_stale", "The complete raw peer workspace changed since the actual-user preview.");
  for (const file of plan.files) currentFile(initial, file);
  if (checkPrivateParents(root, operation.operationId)) return fail("rewind_no_replay", "This original restoration already has private effect state.");
  const files: FileResult[] = [];
  for (const [index, file] of plan.files.entries()) {
    signal.throwIfAborted();
    currentFile(snapshot(root, settings, plan), file);
    await boundary(index, "moving");
    signal.throwIfAborted();
    const current = currentFile(snapshot(root, settings, plan), file);
    let backup: string | null = null;
    if (file.choice === "restore-checkpoint") {
      const check = () => {
        signal.throwIfAborted();
        if (!same(sourceRootSync(root), plan.root)) return fail("rewind_root", "The original root changed before its next filesystem boundary.");
        assertFolderName(file.path, true, folderPolicy(settings));
        checkPrivateParents(root, operation.operationId);
        const displaced = backupFile(root, operation.operationId, index);
        const displacedIdentity = displaced ? requireRemoteCheckpointIdentity(displaced.file) : null;
        const currentIdentity = current ? requireRemoteCheckpointIdentity(current) : null;
        if (displaced && (!current || !currentIdentity || !displacedIdentity || displacedIdentity.device !== currentIdentity.device ||
          displacedIdentity.inode !== currentIdentity.inode || displaced.file.digest !== current.digest ||
          displaced.file.bytes !== current.bytes || displaced.file.mode !== current.mode)) {
          return fail("rewind_conflict", "A concurrent writer changed the displaced original; its actual inode was retained.");
        }
        scopedPathSync(root, file.path, true);
      };
      if (backupFile(root, operation.operationId, index)) return fail("rewind_no_replay", "An original displaced inode already exists for this exact file.");
      backup = await publishRewindFile(root, operation.operationId, index, file.path, current, file.target ?? undefined, check);
    }
    const result: FileResult = { path: file.path, choice: file.choice,
      outcome: file.choice === "keep-current" ? "kept" : file.target ? "written" : "removed",
      digest: file.choice === "keep-current" ? current?.digest ?? null : file.target?.digest ?? null,
      backup, backupDigest: backup ? current!.digest : null };
    originalBackup(plan, index, result); files.push(result);
    await boundary(index, "observed", result);
  }
  signal.throwIfAborted();
  const final = snapshot(root, settings, plan);
  for (const [index, result] of files.entries()) {
    const file = plan.files[index]!, current = final.roots[0]!.files.find((value) => value.path === file.path);
    const expected = file.choice === "keep-current" ? file.current : file.target;
    if ((current?.digest ?? null) !== (expected?.digest ?? null) || (current?.mode ?? null) !== (expected?.mode ?? null) ||
      (current?.bytes ?? null) !== (expected?.bytes ?? null) ||
      file.choice === "keep-current" && !same(current ? descriptor(current) : null, file.current)) {
      return fail("rewind_conflict", "A concurrent writer changed a final restored/kept file.");
    }
    originalBackup(plan, index, result);
  }
  const result: CheckpointRestoreResult = { version: 1, operationId: plan.operationId, root: plan.root, sourceDigest: plan.expectedWorkspaceDigest,
    verified: true, git: final.roots[0]!.git, files };
  if (!Value.Check(CheckpointRestoreResultSchema, result)) return fail("rewind_result", "The complete original restoration result exceeded its typed contract.");
  return result;
}

export function inspectWorkspaceRewind(root: string, plan: CheckpointRestorePlan, settings: ProjectSettings, signal: AbortSignal): WorkspaceRewindInspection {
  validateRemoteRewindPlan(plan, root, settings); signal.throwIfAborted();
  const current = snapshot(root, settings);
  if (!same(current.roots[0]!.binding, plan.root)) return fail("rewind_root", "Read-only inspection found a replaced root, not the original workspace.");
  const result: WorkspaceRewindInspection = { version: 1, operationId: plan.operationId, root: plan.root, workspaceDigest: current.digest,
    git: current.roots[0]!.git, files: plan.files.map((file, index) => {
      signal.throwIfAborted();
      if (current.roots[0]!.excluded.some((path) => pathKey(file.path) === pathKey(path) || pathKey(file.path).startsWith(`${pathKey(path)}/`))) {
        return fail("rewind_inspection", "A reviewed file is now excluded; no omitted content was treated as absent.");
      }
      scopedPathSync(root, file.path, true);
      const live = current.roots[0]!.files.find((value) => value.path === file.path);
      return { index, path: file.path, current: live ? descriptor(live) : null, backup: backupFile(root, plan.operationId, index) };
    }) };
  if (Buffer.byteLength(JSON.stringify(result)) > REMOTE_REWIND_INSPECTION_BYTES) return fail("rewind_limit", "Complete read-only file/backup evidence exceeded its 8 MiB bound.");
  signal.throwIfAborted(); return result;
}
