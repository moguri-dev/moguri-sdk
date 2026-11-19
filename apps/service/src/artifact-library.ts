import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ARTIFACT_LIBRARY_LIMITS, ARTIFACT_OUTPUT_DIRECTORIES, ARTIFACT_WRITE_TOOLS, artifactFileKind, MoguriError,
  type ArtifactFile, type ArtifactLibrary, type ArtifactLibraryRoot, type Session, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath } from "./files.ts";

const outputDirectories = new Set<string>(ARTIFACT_OUTPUT_DIRECTORIES);
const writeTools = new Set<string>(ARTIFACT_WRITE_TOOLS);
/** Dependency, cache and VCS folders that never hold user-facing artifacts and can be very large. */
const skipped = new Set(["node_modules", "CMakeFiles", "deps", "incremental", "__pycache__", "vendor", "Pods", "DerivedData"]);
/** Bundles listed as one artifact instead of walking their (often thousands of) internal files. */
const bundles: Array<[RegExp, ArtifactFile["kind"] | null]> = [[/\.app$/i, "installer"], [/\.(framework|bundle|xcarchive|dSYM|lproj)$/i, null]];
export interface ArtifactLibraryHost {
  snapshot(): Snapshot;
  /** The session's actual Local filesystem root, or null when it has none (Remote/Sandbox, removed worktree). */
  sessionRoot(session: Session): string | null;
}
interface ScanState { entries: number; truncated: boolean; files: Map<string, ArtifactFile> }

const within = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
async function regularFile(path: string) {
  const metadata = await lstat(path).catch((error: unknown) => {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  });
  return metadata?.isFile() && !metadata.isSymbolicLink() ? metadata : null;
}
async function walk(root: string, directory: string, depth: number, sessionId: string | null, state: ScanState, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (state.truncated) return;
  if (depth > ARTIFACT_LIBRARY_LIMITS.depth) { state.truncated = true; return; }
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (++state.entries > ARTIFACT_LIBRARY_LIMITS.entries || state.files.size >= ARTIFACT_LIBRARY_LIMITS.files) { state.truncated = true; return; }
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name), relativePath = relative(root, path);
    if (isProtectedProjectPath(relativePath)) continue;
    if (entry.isDirectory()) {
      if (skipped.has(entry.name)) continue;
      const bundle = bundles.find(([pattern]) => pattern.test(entry.name));
      if (bundle) {
        if (bundle[1]) {
          const metadata = await lstat(path);
          state.files.set(path, { path, relativePath, root, kind: bundle[1], bytes: 0, modifiedAt: metadata.mtime.toISOString(), sessionId, origin: "output" });
        }
        continue;
      }
      await walk(root, path, depth + 1, sessionId, state, signal);
      if (state.truncated) return;
    } else if (entry.isFile()) {
      const kind = artifactFileKind(entry.name);
      if (!kind || state.files.has(path)) continue;
      const metadata = await regularFile(path);
      if (metadata) state.files.set(path, { path, relativePath, root, kind, bytes: metadata.size, modifiedAt: metadata.mtime.toISOString(), sessionId, origin: "output" });
    }
  }
}
/** True when every folder between the canonical root and the file is a real directory, never a symlink to elsewhere. */
async function realParents(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const part of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    current = join(current, part);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return false;
  }
  return true;
}
/** Output folders at the root or up to two levels below it (for example dist/ and apps/desktop/release/). */
async function outputFolders(root: string, state: ScanState): Promise<string[]> {
  const folders: string[] = [];
  const search = async (directory: string, depth: number): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && !skipped.has(entry.name));
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++state.entries > ARTIFACT_LIBRARY_LIMITS.entries) { state.truncated = true; return; }
      const path = join(directory, entry.name);
      if (outputDirectories.has(entry.name)) folders.push(path);
      else if (depth < 2 && !bundles.some(([pattern]) => pattern.test(entry.name))) await search(path, depth + 1);
      if (state.truncated) return;
    }
  };
  await search(root, 0);
  return folders;
}
/**
 * Lists metadata (never content) for build outputs in the project checkout and its sessions' managed worktrees, plus files
 * that Local agents wrote with write_file/write_document/edit_document. Each file keeps its linked session when known.
 */
export async function artifactLibrary(host: ArtifactLibraryHost, projectId: string | null, signal: AbortSignal): Promise<ArtifactLibrary> {
  const snapshot = host.snapshot(), project = projectId === null ? null : snapshot.projects.find((value) => value.id === projectId);
  if (projectId !== null && !project) throw new MoguriError("project_missing", "Choose an existing project in this profile. No other folder was scanned.", 404);
  const sessions = snapshot.sessions.filter((session) => session.projectId === projectId && !session.repositories && session.controls.env === "Local")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const state: ScanState = { entries: 0, truncated: false, files: new Map() }, roots: ArtifactLibraryRoot[] = [];
  const outputRoots: { path: string; sessionId: string | null }[] = project ? [{ path: project.path, sessionId: null }] : [];
  for (const workspace of snapshot.managedWorkspaces.filter((value) => value.projectId === projectId && value.status === "ready")) {
    outputRoots.push({ path: workspace.path, sessionId: sessions.find((session) => session.workspaceId === workspace.id)?.id ?? null });
  }
  for (const root of outputRoots) {
    signal.throwIfAborted();
    const metadata = await lstat(root.path).catch(() => null);
    if (!metadata?.isDirectory()) { roots.push({ ...root, status: "missing", diagnostic: "This folder no longer exists. Nothing was listed from it." }); continue; }
    roots.push({ ...root, status: "scanned", diagnostic: null });
    for (const folder of await outputFolders(root.path, state)) {
      await walk(root.path, folder, 1, root.sessionId, state, signal);
      if (state.truncated) break;
    }
  }
  let agentFiles = 0;
  for (const session of sessions) {
    let root: string | null;
    try { root = host.sessionRoot(session); } catch (error) {
      if (!(error instanceof MoguriError)) throw error;
      root = null;
    }
    if (!root || await realpath(root).catch(() => null) !== root) continue;
    const written = new Set<string>();
    for (const message of session.messages) for (const call of message.toolCalls ?? []) {
      const input = call.arguments.path;
      if (!writeTools.has(call.name) || typeof input !== "string" || isAbsolute(input) && !within(root, input)) continue;
      const path = resolve(root, input);
      if (!within(root, path) || path === root || isProtectedProjectPath(relative(root, path))) continue;
      written.add(path);
    }
    for (const path of written) {
      signal.throwIfAborted();
      const kind = artifactFileKind(path);
      if (!kind) continue;
      if (++agentFiles > ARTIFACT_LIBRARY_LIMITS.agentFiles) { state.truncated = true; break; }
      const existing = state.files.get(path);
      if (existing?.origin === "agent") continue;
      const metadata = await realParents(root, path) ? await regularFile(path) : null;
      if (!metadata) continue;
      state.files.set(path, { path, relativePath: relative(root, path), root, kind, bytes: metadata.size, modifiedAt: metadata.mtime.toISOString(), sessionId: session.id, origin: "agent" });
    }
  }
  const files = [...state.files.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  return { projectId, files, roots, truncated: state.truncated, scannedAt: new Date().toISOString() };
}
