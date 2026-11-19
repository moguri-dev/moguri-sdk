import { mkdir, lstat, open, realpath } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { sameCandidateRoot, validCandidateRoots, type CandidatePatch, type CandidateRoot } from "../../../packages/protocol/src/candidates.ts";
import { candidateBases, candidateBytes, candidateFileBase, candidatePatch } from "./candidate-files.ts";
import { readProjectFile, readRegularFile, scopedPath, writeProjectFile } from "./files.ts";
import { sameDurableIdentity, sourceRoot, sourceRootSync } from "./repository-source.ts";
import { candidateGitState, readGit, readGitBinding } from "./project-git.ts";
import { assertFolderAccess } from "./project-policy.ts";
import { captureNativeTree, type NativeSource } from "./native-staging.ts";
import { CandidateWorkerOperationSchema, type CandidateWorkerResult, type CandidateWorkerScope } from "./candidate-worker-protocol.ts";
import { CandidateNativeRootGrantSchema, type CandidateNativeRootGrant } from "../../../packages/protocol/src/candidate-workspaces.ts";
import { Value } from "typebox/value";
import type { SourceRoot } from "./repository-source.ts";

const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const invalid = (message: string): never => { throw new MoguriError("candidate_transport", `${message} No alternate Env, source or Git checkout was adopted.`, 409); };
const snapshotDigest = (tree: NativeSource) => digest(`moguri-candidate-snapshot-v1\0${JSON.stringify(tree.files.map(({ path, digest, bytes, mode }) => ({ path, digest, bytes, mode })))}`);
export type CandidateRootBinder = (guest: SourceRoot) => Promise<CandidateNativeRootGrant>;
export function candidateIdentity(scope: CandidateWorkerScope, bind?: CandidateRootBinder) {
  const grants = new Map<string, CandidateNativeRootGrant>();
  const capture = async (root: string): Promise<SourceRoot> => {
    const guest = await sourceRoot(root);
    if (scope.env !== "Sandbox") return guest;
    if (scope.nativeRootVersion !== 3 || !bind) return invalid("Native candidates need the versioned actual private-root grant; historical VM identities cannot authorize new effects.");
    let grant = grants.get(root);
    if (!grant) {
      grant = await bind(guest);
      if (!Value.Check(CandidateNativeRootGrantSchema, grant) || grant.root !== root ||
        grant.guest.device !== guest.device || grant.guest.inode !== guest.inode) invalid("The actual private-root acknowledgement changed this VM's observed directory.");
      grants.set(root, structuredClone(grant));
    }
    if (grant.guest.device !== guest.device || grant.guest.inode !== guest.inode) invalid("The granted directory changed inside the original VM.");
    return { root, ...grant.private };
  };
  return { capture, current: (root: string): SourceRoot => {
    const guest = sourceRootSync(root);
    if (scope.env !== "Sandbox") return guest;
    const grant = grants.get(root);
    if (!grant || grant.guest.device !== guest.device || grant.guest.inode !== guest.inode) return invalid("The original VM has no matching retained private-root grant.");
    return { root, ...grant.private };
  } };
}
type CandidateIdentity = ReturnType<typeof candidateIdentity>;
function currentRoot(scope: CandidateWorkerScope, expected: CandidateRoot, root: string, identities: CandidateIdentity): void {
  if (expected.env === "Local" || expected.env !== scope.env || expected.projectId !== scope.projectId ||
    expected.root !== root || JSON.stringify(expected.boundary) !== JSON.stringify(scope.boundary)) invalid("Captured candidate root no longer belongs to this exact peer/private snapshot.");
  if (expected.env === "Sandbox" && expected.version !== 3) invalid("A historical native VM identity is inspection-only, not a private-root grant.");
  const identity = identities.current(root);
  if (!sameDurableIdentity(expected, identity)) invalid("The captured directory was replaced.");
}
async function assertRoot(scope: CandidateWorkerScope, expected: CandidateRoot, signal: AbortSignal, identities: CandidateIdentity) {
  signal.throwIfAborted(); await identities.capture(expected.root); currentRoot(scope, expected, expected.root, identities);
  if (expected.env === "Remote" && !sameCandidateRoot(expected, { ...expected, ...await readGitBinding(expected.root, signal) })) invalid("The original HEAD, branch or common Git directory changed.");
  signal.throwIfAborted(); currentRoot(scope, expected, expected.root, identities);
}
async function privateDirectory(path: string, create: boolean) {
  if (!isAbsolute(path)) invalid("Owned candidate state must be an absolute private directory.");
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
    metadata.mode & 0o077 || await realpath(path) !== path) invalid("Owned candidate state is aliased, replaced or no longer private.");
}
export function candidateStagePath(scope: CandidateWorkerScope, workspaceId: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(workspaceId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(scope.profileId)) invalid("Owned candidate workspace identity is invalid.");
  return join(scope.stateRoot, "candidate-workspaces", scope.profileId, workspaceId, "workspace");
}
async function assertStage(scope: CandidateWorkerScope, source: CandidateRoot, stage: CandidateRoot, signal: AbortSignal, identities: CandidateIdentity) {
  if (!stage.workspaceId || stage.root !== candidateStagePath(scope, stage.workspaceId) ||
    !validCandidateRoots(source, stage, scope.projectId)) invalid("Staging is not the exact explicitly created owned candidate resource.");
  await privateDirectory(dirname(stage.root), false);
  const marker = JSON.parse((await readRegularFile(join(dirname(stage.root), "owner.json"), 32 * 1024)).toString("utf8"));
  if (JSON.stringify(marker) !== JSON.stringify({ format: "moguri-candidate-workspace", version: 1, profileId: scope.profileId,
    projectId: scope.projectId, workspaceId: stage.workspaceId, source, stage })) invalid("Original owned workspace marker changed.");
  await assertRoot(scope, source, signal, identities); await assertRoot(scope, stage, signal, identities);
}
async function assertCleanStage(scope: CandidateWorkerScope, stage: CandidateRoot, signal: AbortSignal) {
  const dirty = stage.env === "Remote" ? (await readGit(stage.root, ["status", "--porcelain=v1", "--untracked-files=all"], signal)).length > 0 :
    stage.env !== "Sandbox" || snapshotDigest(await captureNativeTree(stage.root, scope.folders, signal)) !== stage.snapshotDigest;
  if (dirty) throw new MoguriError("candidate_stage_busy", "The owned candidate resource has newer changes. Preserve it and explicitly create/select another stage.", 409);
}
async function selectedFiles(root: string, paths: string[], scope: CandidateWorkerScope) {
  const files: Array<{ path: string; baseDigest: string; text: string | null }> = [];
  for (const path of paths) {
    candidatePatch({ kind: "patch", summary: "Exact source read", edits: [{ path, baseDigest: "absent", text: "" }] });
    await assertFolderAccess(root, path, false, scope.folders);
    const baseDigest = await candidateFileBase(root, path), file = baseDigest === "absent" ? null : await readProjectFile(root, path);
    if (file && file.digest !== baseDigest) invalid("Source bytes changed during the exact read.");
    files.push({ path, baseDigest, text: file?.text ?? null });
  }
  if (Buffer.byteLength(JSON.stringify(files)) > 64 * 1024) invalid("Complete selected source exceeds 64 KiB; nothing was truncated.");
  return files;
}
async function captureRoot(root: string, scope: CandidateWorkerScope, signal: AbortSignal, identities: CandidateIdentity): Promise<CandidateRoot> {
  const identity = await identities.capture(root), boundary = scope.boundary;
  if (scope.env === "Remote" && boundary.env === "Remote") return { version: 2, env: "Remote", projectId: scope.projectId,
    workspaceId: scope.sourceWorkspaceId, ...identity, ...await readGitBinding(root, signal), boundary };
  if (scope.env === "Sandbox" && boundary.env === "Sandbox") return { version: 3, identityNamespace: "controller-private-stage", env: "Sandbox", projectId: scope.projectId, workspaceId: scope.sourceWorkspaceId,
    ...identity, snapshotDigest: snapshotDigest(await captureNativeTree(root, scope.folders, signal)), boundary };
  return invalid("Candidate scope and actual Env disagree.");
}
export async function candidateWorkerState(scope: CandidateWorkerScope, source: CandidateRoot, stage: CandidateRoot,
  patch: CandidatePatch, signal: AbortSignal, identities = candidateIdentity(scope)) {
  await assertStage(scope, source, stage, signal, identities);
  const files = await candidateBytes(stage.root, patch);
  const state = stage.env === "Remote" ? await candidateGitState(stage.root, signal) : snapshotDigest(await captureNativeTree(stage.root, scope.folders, signal));
  const sourceState = source.env === "Remote" ? await candidateGitState(source.root, signal) : snapshotDigest(await captureNativeTree(source.root, scope.folders, signal));
  signal.throwIfAborted(); return digest(JSON.stringify({ source, stage, files, state, sourceState }));
}
export async function executeCandidateOperation(root: string, value: unknown, signal: AbortSignal,
  boundary: (phase: "attempt" | "observed", path: string | null) => Promise<void>, bind?: CandidateRootBinder): Promise<CandidateWorkerResult> {
  const operation = structuredClone(parse(CandidateWorkerOperationSchema, value)), scope = operation.scope;
  const identities = candidateIdentity(scope, bind);
  signal.throwIfAborted();
  if (scope.env !== scope.boundary.env || root !== scope.boundary.sourceRoot || await realpath(root) !== root) invalid("Worker/source does not match the originally pinned root.");
  if (operation.action === "source") {
    const source = await captureRoot(root, scope, signal, identities), files = await selectedFiles(root, operation.paths, scope);
    await assertRoot(scope, source, signal, identities); return { type: "source", source, files };
  }
  const source = operation.source; await assertRoot(scope, source, signal, identities);
  if (source.root !== root || source.workspaceId !== scope.sourceWorkspaceId) invalid("Original source root or workspace changed.");
  if (operation.action === "create") {
    const actual = await captureRoot(root, scope, signal, identities);
    if (!sameCandidateRoot(source, actual)) invalid("Reviewed source/base changed before explicit workspace creation.");
    const stagePath = candidateStagePath(scope, operation.workspaceId), directory = dirname(stagePath);
    const overlap = relative(root, scope.stateRoot);
    if (scope.env === "Remote" && (!isAbsolute(overlap) && overlap !== ".." && !overlap.startsWith("../"))) invalid("Peer-owned worktree state must be separate from the source checkout.");
    await privateDirectory(scope.stateRoot, true);
    await privateDirectory(dirname(directory), true);
    signal.throwIfAborted(); await boundary("attempt", null);
    await assertRoot(scope, source, signal, identities);
    await mkdir(directory, { mode: 0o700 });
    if (source.env === "Remote") {
      await readGit(root, ["worktree", "add", "--detach", "--", stagePath, source.head], signal);
    } else if (source.env === "Sandbox") {
      const tree = await captureNativeTree(root, scope.folders, signal);
      if (snapshotDigest(tree) !== source.snapshotDigest) invalid("Reviewed private snapshot changed before its copy.");
      await mkdir(stagePath, { mode: 0o700 });
      await identities.capture(stagePath);
      for (const file of tree.files) {
        signal.throwIfAborted();
        const destination = join(stagePath, file.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await scopedPath(stagePath, file.path, true);
        const bytes = await readRegularFile(await scopedPath(root, file.path), file.bytes);
        if (digest(bytes) !== file.digest) invalid("Original private snapshot changed while copying approved bytes.");
        const target = await open(destination, "wx", file.mode);
        try { await target.writeFile(bytes); await target.sync(); } finally { await target.close(); }
      }
      if (snapshotDigest(await captureNativeTree(stagePath, scope.folders, signal)) !== source.snapshotDigest ||
        snapshotDigest(await captureNativeTree(root, scope.folders, signal)) !== source.snapshotDigest) invalid("Full private snapshot readback differs; the partial owned resource was retained.");
    } else return invalid("A Local source cannot acquire a peer/native workspace.");
    const identity = await identities.capture(stagePath);
    const stage: CandidateRoot = source.env === "Remote" ? { ...source, ...identity, workspaceId: operation.workspaceId, ...await readGitBinding(stagePath, signal) } :
      { ...source, ...identity, workspaceId: operation.workspaceId };
    const marker = await open(join(directory, "owner.json"), "wx", 0o600);
    try { await marker.writeFile(JSON.stringify({ format: "moguri-candidate-workspace", version: 1, profileId: scope.profileId,
      projectId: scope.projectId, workspaceId: operation.workspaceId, source, stage })); await marker.sync(); } finally { await marker.close(); }
    await assertStage(scope, source, stage, signal, identities); await boundary("observed", null);
    return { type: "created", source, stage };
  }
  const stage = operation.stage; await assertStage(scope, source, stage, signal, identities);
  if (operation.action === "inspect") {
    if (operation.clean) {
      await assertCleanStage(scope, stage, signal);
    }
    const files = await selectedFiles(root, operation.paths, scope), stageFiles = await selectedFiles(stage.root, operation.paths, scope);
    await assertStage(scope, source, stage, signal, identities);
    return { type: "inspected", source, stage, files, stageFiles };
  }
  const patch = candidatePatch(operation.patch);
  for (const edit of patch.edits) {
    await assertFolderAccess(root, edit.path, true, scope.folders);
    await assertFolderAccess(stage.root, edit.path, true, scope.folders);
  }
  if (operation.action === "state") return { type: "state", digest: await candidateWorkerState(scope, source, stage, patch, signal, identities) };
  if (operation.phase === "stage") await assertCleanStage(scope, stage, signal);
  await candidateBases(root, patch);
  if (operation.phase === "apply") await candidateBytes(stage.root, patch);
  const destination = operation.phase === "stage" ? stage.root : root;
  const bases = await Promise.all(patch.edits.map((edit) => operation.phase === "stage" ? candidateFileBase(destination, edit.path) : edit.baseDigest));
  if (operation.phase === "stage") await assertCleanStage(scope, stage, signal);
  for (const [index, edit] of patch.edits.entries()) {
    signal.throwIfAborted(); await assertStage(scope, source, stage, signal, identities);
    if (operation.phase === "apply") await candidateBytes(stage.root, patch);
    await boundary("attempt", edit.path); signal.throwIfAborted();
    await assertStage(scope, source, stage, signal, identities);
    await writeProjectFile(destination, edit.path, edit.text, bases[index]!, {
      signal, beforeCommit: () => { signal.throwIfAborted(); currentRoot(scope, source, root, identities); currentRoot(scope, stage, stage.root, identities); },
    });
    const observed = await readProjectFile(destination, edit.path);
    if (observed.text !== edit.text || observed.digest !== digest(edit.text)) invalid("Published file bytes changed before their exact per-file readback receipt.");
    await boundary("observed", edit.path);
  }
  const files = await candidateBytes(destination, patch); await assertStage(scope, source, stage, signal, identities);
  return { type: "written", result: { version: 2, candidateId: operation.candidateId, phase: operation.phase, source, stage, readback: true, files } };
}
