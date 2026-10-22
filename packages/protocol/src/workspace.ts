import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const PackageManagerSchema = Type.Union([Type.Literal("npm"), Type.Literal("pnpm"), Type.Literal("python"), Type.Literal("cargo"), Type.Literal("go")]);
export type PackageManager = Static<typeof PackageManagerSchema>;
export const DependencyRegistryConfigSchema = object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  url: Type.String({ minLength: 1, maxLength: 2048 }),
  packages: Type.Array(Type.String({ minLength: 1, maxLength: 214 }), { minItems: 1, maxItems: 100 }),
  advisoryUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  sharePrivateMetadata: Type.Boolean(),
});
export type DependencyRegistryConfig = Static<typeof DependencyRegistryConfigSchema>;
export interface DependencyRegistry extends DependencyRegistryConfig {
  id: string; profileId: string; revision: number; credentialRevision: string;
}
export interface DependencyRegistryPreview extends DependencyRegistry {
  credential: "configured" | "required"; diagnostic: string;
}
export interface WorkspaceEventPayloads {
  "cache.registry.saved": { registry: DependencyRegistry };
  "cache.registry.removed": { registryId: string };
}
export const IssueKindSchema = Type.Union([Type.Literal("feature"), Type.Literal("bug"), Type.Literal("misc")]);
export type IssueKind = Static<typeof IssueKindSchema>;
export const BoardConfigSchema = object({
  columns: Type.Array(object({ id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,39}$" }), name: Type.String({ minLength: 1, maxLength: 60 }) }), { minItems: 2, maxItems: 12 }),
  mergedColumnId: id, autoRefreshPrs: Type.Boolean(),
  githubAccess: Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]),
  linear: object({ enabled: Type.Boolean(), teamId: Type.String({ maxLength: 128 }) }),
});
export type BoardConfig = Static<typeof BoardConfigSchema>;
export interface IssueBoard extends BoardConfig { projectId: string; revision: number }
export const defaultBoard = (projectId: string): IssueBoard => ({
  projectId, revision: 0, columns: [{ id: "backlog", name: "Backlog" }, { id: "in-progress", name: "In progress" }, { id: "review", name: "Review" }, { id: "done", name: "Done" }],
  mergedColumnId: "done", autoRefreshPrs: true, githubAccess: "public", linear: { enabled: false, teamId: "" },
});
export interface PullRequestLink {
  url: string; repo: string; number: number; state: "unknown" | "open" | "closed" | "merged";
  checkedAt: string | null; diagnostic: string | null;
}
export interface LocalIssue {
  id: string; projectId: string; number: number; title: string; body: string; kind: IssueKind;
  phaseId: string; revision: number; archived: boolean; createdAt: string; updatedAt: string;
  pullRequest: PullRequestLink | null;
  linear: { id: string; identifier: string; url: string; updatedAt: string } | null;
}
export type IssueInput = Pick<LocalIssue, "title" | "body" | "kind" | "phaseId"> & { pullRequestUrl: string | null };
const issueFields = {
  title: Type.String({ minLength: 1, maxLength: 160 }), body: Type.String({ maxLength: 64 * 1024 }), kind: IssueKindSchema,
  phaseId: id, pullRequestUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
};
export const IssueInputSchema = object(issueFields);
export const WorkspaceCommandSchema = Type.Union([
  object({ type: Type.Literal("board.save"), projectId: id, expectedRevision: revision, config: BoardConfigSchema }),
  object({ type: Type.Literal("issue.create"), projectId: id, ...issueFields }),
  object({ type: Type.Literal("issue.update"), issueId: id, expectedRevision: revision, ...issueFields }),
  object({ type: Type.Literal("issue.move"), issueId: id, expectedRevision: revision, phaseId: id }),
  object({ type: Type.Literal("issue.archive"), issueId: id, expectedRevision: revision, archived: Type.Boolean() }),
  object({ type: Type.Literal("issues.refresh"), projectId: id }),
  object({ type: Type.Literal("cache.prepare"), projectId: id, workspaceId: Type.Optional(id), manager: PackageManagerSchema, expectedDigest: hash, acceptMetadataSharing: Type.Literal(true) }),
  object({ type: Type.Literal("cache.install"), projectId: id, workspaceId: Type.Optional(id), manager: PackageManagerSchema, expectedDigest: hash, acceptMetadataSharing: Type.Literal(true), runScripts: Type.Boolean() }),
  object({ type: Type.Literal("cache.registry.save"), registryId: Type.Optional(id), expectedRevision: revision, config: DependencyRegistryConfigSchema }),
  object({ type: Type.Literal("cache.registry.remove"), registryId: id, expectedRevision: revision }),
  object({ type: Type.Literal("cache.registry.token.set"), registryId: id, token: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ type: Type.Literal("cache.registry.token.clear"), registryId: id }),
  object({ type: Type.Literal("linear.token.set"), token: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ type: Type.Literal("linear.token.clear") }),
  object({ type: Type.Literal("linear.import"), projectId: id, cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })) }),
]);
export type WorkspaceCommand = Static<typeof WorkspaceCommandSchema>;
export const isWorkspaceCommand = (value: unknown): value is WorkspaceCommand => Value.Check(WorkspaceCommandSchema, value);
export const WorkspaceQuerySchema = Type.Union([
  object({ type: Type.Literal("board.get"), projectId: id }),
  object({ type: Type.Literal("cache.inspect"), projectId: id, workspaceId: Type.Optional(id), manager: PackageManagerSchema }),
  object({ type: Type.Literal("cache.registries") }),
  object({ type: Type.Literal("linear.status"), projectId: id }),
]);
export type WorkspaceQuery = Static<typeof WorkspaceQuerySchema>;
export const isWorkspaceQuery = (value: unknown): value is WorkspaceQuery => Value.Check(WorkspaceQuerySchema, value);
export interface DependencyPackage {
  name: string; version: string; integrity: string; url: string; hasInstallScript: boolean;
  ecosystem?: "npm" | "PyPI" | "crates.io" | "Go";
  registryId?: string; scope?: string; filename?: string;
  sourceIntegrity?: string; artifactKind?: "archive" | "metadata" | "module";
}
export interface DependencyManifest { path: string; digest: string; name: string | null }
export interface DependencyPlan {
  workspaceId?: string | null;
  root?: { path: string; device: string; inode: string };
  projectId: string; manager: PackageManager; manifestDigest: string; lockDigest: string; digest: string;
  packages: DependencyPackage[]; cachedPackages: number; npmCache: string; pnpmStore: string;
  manifests?: DependencyManifest[]; registryScopes?: { registryId: string; revision: number; resource: string; scope: string; advisoryUrl: string; metadataSharing: boolean }[];
  cachePath?: string; mode?: "script-free-install" | "cache-only";
  readiness?: { ready: boolean; diagnostic: string; command: string[] };
  scripts: "blocked"; diagnostic: string;
}
export interface CacheReceipt {
  workspaceId?: string | null;
  projectId: string; manager: PackageManager; digest: string; lockDigest: string; checkedAt: string;
  packages: number; reused: number; downloadedBytes: number; scripts: "blocked";
}
export interface WorkspaceSnapshot { boards: IssueBoard[]; issues: LocalIssue[]; dependencyCaches: CacheReceipt[]; dependencyRegistries: DependencyRegistry[] }
export type WorkspaceResponse =
  | { type: "board.get"; board: IssueBoard; issues: LocalIssue[] }
  | { type: "cache.inspect"; plan: DependencyPlan }
  | { type: "cache.registries"; registries: DependencyRegistryPreview[] }
  | { type: "linear.status"; enabled: boolean; credential: "configured" | "required"; diagnostic: string };
