import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { SessionHomeRootSchema } from "./sessions.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096, pattern: "^/[^\\u0000\\r\\n]*$" });
const relative = Type.String({ minLength: 1, maxLength: 4096, pattern: "^(?:\\.|(?!/)(?!(?:.*/)?\\.\\.?(?:/|$))[^\\u0000\\r\\n]*[^/\\u0000\\r\\n])$" });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const timestamp = Type.String({ format: "date-time" });
const message = Type.String({ minLength: 1, maxLength: 2000 });

/** Directory levels below the chosen folder that discovery inspects. */
export const WORKSPACE_FOLDER_SCAN_DEPTH = 3;
export const WORKSPACE_FOLDER_MAX_REPOSITORIES = 500;
/** Default interval between automatic checks of folders kept in sync. */
export const WORKSPACE_FOLDER_SYNC_MS = 5 * 60_000;

/** The actual user's consent to let Moguri read and list repositories in this folder. It never trusts repository scripts. */
export const WorkspaceFolderTrustSchema = object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, at: timestamp });
export const WorkspaceFolderSchema = object({
  version: Type.Literal(1), id, profileId: id, root: SessionHomeRootSchema, sync: Type.Boolean(),
  /** Repositories the user left out, relative to the root. Sync never adds them. */
  excluded: Type.Array(relative, { maxItems: 1000, uniqueItems: true }),
  trust: WorkspaceFolderTrustSchema, revision: count, createdAt: timestamp, updatedAt: timestamp,
});
export type WorkspaceFolder = Static<typeof WorkspaceFolderSchema>;
export const WorkspaceFolderEntrySchema = object({
  path, relative, name: Type.String({ minLength: 1, maxLength: 255 }),
  disposition: Type.Union([Type.Literal("new"), Type.Literal("registered"), Type.Literal("excluded")]),
  projectId: nullable(id),
});
export type WorkspaceFolderEntry = Static<typeof WorkspaceFolderEntrySchema>;
export const WorkspaceFolderReviewSchema = object({
  format: Type.Literal("moguri-workspace-folder"), version: Type.Literal(1), profileId: id,
  root: SessionHomeRootSchema, folderId: nullable(id), folderRevision: nullable(count),
  policyRevision: count, registrationsDigest: hash, complete: Type.Boolean(), diagnostic: nullable(message),
  /** Linked Git worktrees and submodule checkouts found while scanning. They are never imported. */
  linkedWorktrees: count,
  entries: Type.Array(WorkspaceFolderEntrySchema, { maxItems: WORKSPACE_FOLDER_MAX_REPOSITORIES }),
});
export type WorkspaceFolderReview = Static<typeof WorkspaceFolderReviewSchema>;
export interface WorkspaceFolderPreview { document: WorkspaceFolderReview; digest: string }
/** Latest in-memory check of a folder. It is not persisted, so unchanged checks never append history. */
export interface WorkspaceFolderObservation {
  folderId: string; status: "idle" | "checking"; checkedAt: string | null; complete: boolean; diagnostic: string | null;
  /** Repositories added by the latest check. */
  added: number;
  /** New repositories the latest check found but did not add because sync is off. */
  available: number;
  /** Projects from this folder whose directory is missing. They are never removed automatically. */
  missing: string[];
}
export const WorkspaceFolderCommandSchema = Type.Union([
  object({ type: Type.Literal("projects.folders.import"), path, expectedDigest: hash,
    include: Type.Array(relative, { maxItems: WORKSPACE_FOLDER_MAX_REPOSITORIES, uniqueItems: true }), sync: Type.Boolean(), trust: Type.Literal(true) }),
  object({ type: Type.Literal("projects.folders.configure"), folderId: id, expectedRevision: count, sync: Type.Boolean() }),
  object({ type: Type.Literal("projects.folders.check"), folderId: id }),
  object({ type: Type.Literal("projects.folders.remove"), folderId: id, expectedRevision: count }),
]);
export const WorkspaceFolderQuerySchema = Type.Union([
  object({ type: Type.Literal("projects.folders.preview"), path }),
  object({ type: Type.Literal("projects.folders.status") }),
]);
export type WorkspaceFolderCommand = Static<typeof WorkspaceFolderCommandSchema>;
export type WorkspaceFolderQuery = Static<typeof WorkspaceFolderQuerySchema>;
export type WorkspaceFolderResponse =
  | { type: "projects.folders.preview"; preview: WorkspaceFolderPreview }
  | { type: "projects.folders.status"; folders: WorkspaceFolderObservation[] };
export interface WorkspaceFolderEventPayloads {
  "workspace_folder.saved": { folder: WorkspaceFolder };
  "workspace_folder.removed": { folderId: string };
}
export const workspaceFolderEventTypes = ["workspace_folder.saved", "workspace_folder.removed"] as const;
export const isWorkspaceFolderCommand = (value: unknown): value is WorkspaceFolderCommand => Value.Check(WorkspaceFolderCommandSchema, value);
export const isWorkspaceFolderQuery = (value: unknown): value is WorkspaceFolderQuery => Value.Check(WorkspaceFolderQuerySchema, value);
/** Projects registered from a workspace folder are read-only sources: Moguri works only in its own worktrees. */
export const readOnlySource = (project: { workspaceFolderId?: string } | null | undefined): boolean => Boolean(project?.workspaceFolderId);
/** A path relative to the folder root; the root itself is ".". */
export const folderRelativePath = (root: string, path: string): string | null =>
  path === root ? "." : path.startsWith(root === "/" ? "/" : `${root}/`) ? path.slice(root === "/" ? 1 : root.length + 1) : null;

export function projectWorkspaceFolder(previous: WorkspaceFolder | undefined, value: unknown): WorkspaceFolder {
  const corrupt = (): never => { throw new MoguriError("workspace_folder_corrupt", "A workspace folder lost its original root, trust or monotonic revision. State was preserved.", 409); };
  if (!Value.Check(WorkspaceFolderSchema, value)) return corrupt();
  const next = value, iso = (at: string) => Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
  if (![next.createdAt, next.updatedAt, next.trust.at].every(iso) || next.updatedAt < next.createdAt) return corrupt();
  if (!previous) {
    if (next.revision !== 0 || next.createdAt !== next.updatedAt) return corrupt();
  } else if (next.revision !== previous.revision + 1 || next.id !== previous.id || next.profileId !== previous.profileId ||
    JSON.stringify(next.root) !== JSON.stringify(previous.root) || next.createdAt !== previous.createdAt || next.updatedAt < previous.updatedAt ||
    next.trust.at < previous.trust.at) return corrupt();
  return structuredClone(next);
}
