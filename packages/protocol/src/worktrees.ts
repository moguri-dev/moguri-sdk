import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const revision = Type.Integer({ minimum: 0 });
export interface ManagedWorkspace {
  id: string; projectId: string; path: string; branch: string; baseCommit: string; gitCommonDir: string;
  status: "creating" | "ready" | "removing" | "partial" | "removed";
  revision: number; createdAt: string; jobId: string | null; diagnostic: string | null;
  identity: { device: string; inode: string } | null;
  changeSetId: string;
}
export interface ChangeSet {
  id: string; projectId: string; workspaceId: string; branch: string; baseCommit: string;
  issueId: string | null; prUrl: string | null; createdAt: string;
}
export interface WorkspaceInspection {
  workspace: ManagedWorkspace; registered: boolean; locked: boolean; exists: boolean; canonical: boolean;
  branch: string | null; head: string | null; status: string | null; diagnostic: string | null;
}
export interface GitWorkspaceRegistration { path: string; branch: string | null; head: string | null; locked: boolean; managedId: string | null }
export const ManagedWorkspaceCommandSchema = Type.Union([
  object({ type: Type.Literal("workspace.create"), projectId: id, branch: Type.String({ minLength: 1, maxLength: 200 }), baseRef: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), issueId: Type.Optional(id), prUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })) }),
  object({ type: Type.Literal("workspace.remove"), workspaceId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("workspace.reconcile"), workspaceId: id, expectedRevision: revision }),
  object({ type: Type.Literal("session.workspace"), sessionId: id, workspaceId: Type.Union([id, Type.Null()]), expectedRevision: revision }),
]);
export type ManagedWorkspaceCommand = Static<typeof ManagedWorkspaceCommandSchema>;
export const isManagedWorkspaceCommand = (value: unknown): value is ManagedWorkspaceCommand => Value.Check(ManagedWorkspaceCommandSchema, value);
export const ManagedWorkspaceQuerySchema = Type.Union([
  object({ type: Type.Literal("workspace.discover"), projectId: id }),
  object({ type: Type.Literal("workspace.inspect"), workspaceId: id }),
  object({ type: Type.Literal("session.git"), sessionId: id, diff: Type.Boolean() }),
  object({ type: Type.Literal("session.files"), sessionId: id, path }),
  object({ type: Type.Literal("session.file"), sessionId: id, path }),
]);
export type ManagedWorkspaceQuery = Static<typeof ManagedWorkspaceQuerySchema>;
export const isManagedWorkspaceQuery = (value: unknown): value is ManagedWorkspaceQuery => Value.Check(ManagedWorkspaceQuerySchema, value);
export type ManagedWorkspaceResponse =
  | { type: "workspace.discover"; registrations: GitWorkspaceRegistration[] }
  | { type: "workspace.inspect"; inspection: WorkspaceInspection }
  | { type: "session.git"; branch: string; repository: string | null; status: string; diff: string }
  | { type: "session.files"; path: string; entries: string[] }
  | { type: "session.file"; path: string; text: string; digest: string; bytes: number };
