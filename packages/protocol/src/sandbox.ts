import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { CandidatePatchSchema } from "./candidates.ts";
import type { CapabilityJob } from "./platform.ts";
import { MoguriError } from "./core.ts";
import { SessionRepositorySchema } from "./repository-roots.ts";
import { SandboxVersionSchema, SandboxSetupCommandSchema, SandboxSetupQuerySchema, type SandboxSetupResponse, type SandboxNetworkScope } from "./sandbox-management.ts";
export * from "./sandbox-management.ts";

const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
export const SandboxQualificationSchema = object({
  release: SandboxVersionSchema, hostSha256: hash, keySha256: hash, manifestSha256: hash,
  workerDigest: hash, bridgeDigest: hash,
  trustRootId: Type.String({ minLength: 1, maxLength: 128 }),
  minimumReleaseSequence: Type.Integer({ minimum: 7, maximum: Number.MAX_SAFE_INTEGER }),
  allowedDomains: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 32, uniqueItems: true }),
  allowCopilot: Type.Boolean(),
  resources: object({ cpus: Type.Integer({ minimum: 1, maximum: 8 }), memoryMb: Type.Integer({ minimum: 1024, maximum: 16384 }), diskMb: Type.Integer({ minimum: 1024, maximum: 16384 }) }),
});
export type SandboxQualification = Static<typeof SandboxQualificationSchema>;
export const SandboxConfigurationSchema = object({
  executable: path, configPath: Type.Union([path, Type.Null()]), image: Type.Union([path, Type.Null()]),
  bundlePath: Type.Union([path, Type.Null()]), trustRootPath: Type.Union([path, Type.Null()]),
  qualification: Type.Optional(SandboxQualificationSchema),
});
export type SandboxConfiguration = Static<typeof SandboxConfigurationSchema>;
export interface NativeDirectoryIdentity { device: string; inode: string }
export interface NativeStageOwner { profileId: string; sessionId: string; turnId: string }
export interface NativeStage extends NativeStageOwner {
  readonly parent: string; readonly directory: string; readonly workspace: string; readonly sourceDigest: string;
  readonly identity: NativeDirectoryIdentity; readonly workspaceIdentity: NativeDirectoryIdentity;
}
export const SandboxRepositorySchema = object({
  ...SessionRepositorySchema.properties, directory: Type.String({ pattern: "^repositories/[a-f0-9]{64}$" }),
  guestRoot: path, sourceHead: Type.Union([Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), Type.Null()]),
});
export const SandboxRepositoriesSchema = Type.Array(SandboxRepositorySchema, { minItems: 1, maxItems: 1000 });
export type SandboxRepository = Static<typeof SandboxRepositorySchema>;
export function sandboxRepositories(value: unknown): SandboxRepository[] {
  if (!Value.Check(SandboxRepositoriesSchema, value) || new Set(value.map((entry) => entry.projectId)).size !== value.length ||
    new Set(value.map((entry) => entry.directory)).size !== value.length || value.some((entry) => entry.guestRoot !== `/workspace/${entry.directory}` ||
      !entry.root.root.startsWith("/") || !entry.root.root.isWellFormed() || /[\0\r\n]/.test(entry.root.root))) {
    throw new MoguriError("sandbox_repository_history", "Native group history lost its exact captured repository or private-directory mapping. No first root or replacement was inferred.", 409);
  }
  return structuredClone(value);
}
export interface SandboxReadiness {
  ready: boolean; configured: boolean; diagnostic: string; configDigest: string | null;
  release: string | null; workerDigest: string | null; image: string | null;
}
export interface SandboxWorkspace {
  id: string; sessionId: string; projectId: string | null; sourceWorkspaceId: string | null;
  sourceRoot: string | null; sourceHead: string | null; inputDigest: string;
  stage: NativeStage | null; authorityDigest: string; configDigest: string; revision: number; createdAt: string;
  commandId: string; commandDigest: string;
  preparation?: { version: 1; kind: "automatic"; turnId: string };
  repositories?: SandboxRepository[];
  status: "preparing" | "ready" | "partial" | "closed"; diagnostic: string | null;
}
export interface SandboxExecution {
  id: string; profileId: string; sessionId: string; projectId: string | null; turnId: string; workspaceId: string;
  sourceWorkspaceId: string | null;
  stage: NativeStage; sourceRoot: string | null; inputDigest: string; config: SandboxConfiguration; configDigest: string;
  image: string; workerDigest: string; launchName: string; command: string[]; createdAt: string;
  root: string | null;
  createdAfter: number; createdBefore: number; nativeSessionId: string | null; planDigest: string | null; signerFingerprint: string | null;
  status: "launching" | "running" | "stopping" | "completed" | "stopped" | "failed" | "partial" | "unconfirmed";
  cancellation: "none" | "requested" | "acknowledged" | "unconfirmed";
  cleanup: "pending" | "owned-guest-stopped" | "unconfirmed" | "acknowledged";
  diagnostic: string | null; lastSequence: number; workerPid: number | null; cliExitCode: number | null;
  resultDigest: string | null; revision: number;
  networkScope?: SandboxNetworkScope;
  workerOutcome?: "completed" | "stopped" | "failed" | "partial";
  workerDiagnostic?: string | null;
  inspectionIntent?: { commandId: string; commandDigest: string; status: "running" | "completed" | "partial" };
  repositories?: SandboxRepository[];
}
export interface SandboxWorkspacePreview {
  digest: string; sessionId: string; sourceRoot: string | null; paths: string[]; bytes: number;
  files: Array<{ path: string; text: string; digest: string; bytes: number }>;
  sourceHead: string | null; configDigest: string; diagnostic: string;
}
const SandboxResultV1Schema = object({
  format: Type.Literal("moguri-native-result"), version: Type.Literal(1), executionId: id, workspaceId: id, inputDigest: hash,
  nativeSessionId: Type.String({ pattern: "^[a-f0-9]{32}$" }), planDigest: hash, signerFingerprint: hash, auditDigest: hash,
  beforeId: hash, afterId: hash, afterBinding: Type.Literal("unique-private-store"),
  rollback: Type.Union([Type.Literal("confirmed"), Type.Literal("not-requested")]), exitCode: Type.Union([Type.Integer({ minimum: 0, maximum: 255 }), Type.Null()]),
  files: Type.Array(object({ path, text: Type.String({ maxLength: 128 * 1024 }), digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }),
    mode: Type.Integer({ minimum: 0, maximum: 0o7777 }) }), { maxItems: 200 }),
  deletedPaths: Type.Array(path, { maxItems: 200 }),
  excluded: Type.Array(object({ path, reason: Type.String({ maxLength: 512 }) }), { maxItems: 200 }),
  excludedCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
  journal: object({ status: Type.Union([Type.Literal("verified"), Type.Literal("unconfirmed")]), diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]) }),
});
export const SandboxResultSchema = Type.Union([SandboxResultV1Schema,
  object({ ...SandboxResultV1Schema.properties, version: Type.Literal(2), repositories: SandboxRepositoriesSchema })]);
export type SandboxResult = Static<typeof SandboxResultSchema>;
const SandboxPublicationV1DocumentSchema = object({
  format: Type.Literal("moguri-native-publication"), version: Type.Literal(1), executionId: id, inputDigest: hash, resultDigest: hash,
  projectId: id, workspaceId: Type.Union([id, Type.Null()]), root: path, device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }),
  git: Type.Union([object({ gitCommonDir: path, branch: Type.String({ minLength: 1, maxLength: 200 }), head: Type.String({ pattern: "^([a-f0-9]{40}|[a-f0-9]{64})$" }) }), Type.Null()]),
  authorityDigest: hash, patch: CandidatePatchSchema,
});
export const SandboxPublicationDocumentSchema = Type.Union([SandboxPublicationV1DocumentSchema,
  object({ ...SandboxPublicationV1DocumentSchema.properties, version: Type.Literal(2), repositories: SandboxRepositoriesSchema, repositoryId: id })]);
export type SandboxPublicationDocument = Static<typeof SandboxPublicationDocumentSchema>;
export interface SandboxPublication {
  version: 1 | 2;
  id: string; profileId: string; projectId: string; workspaceId: string | null; executionId: string; sourceSessionId: string;
  root: string; inputDigest: string; resultDigest: string; documentDigest: string; paths: string[];
  revision: number; createdAt: string; updatedAt: string; jobId: string; commandId: string; commandDigest: string;
  status: "publishing" | "completed" | "partial" | "failed" | "stopped";
  stopRequested?: boolean;
  attemptedPaths: string[]; publishedPaths: string[]; createdDirectories: string[]; operationDigest: string | null; diagnostic: string | null;
  acceptance: { actor: "user"; commandId: string; commandDigest: string; reviewDigest: string; authorityDigest: string };
  repositories?: SandboxRepository[]; repositoryId?: string;
}
const publicationPaths = Type.Array(path, { maxItems: 20, uniqueItems: true });
const SandboxPublicationV1Schema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, workspaceId: Type.Union([id, Type.Null()]), executionId: id, sourceSessionId: id,
  root: path, inputDigest: hash, resultDigest: hash, documentDigest: hash, paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }),
  revision, createdAt: Type.String({ maxLength: 32 }), updatedAt: Type.String({ maxLength: 32 }), jobId: id, commandId: id, commandDigest: hash,
  status: Type.Union([Type.Literal("publishing"), Type.Literal("completed"), Type.Literal("partial"), Type.Literal("failed"), Type.Literal("stopped")]),
  attemptedPaths: publicationPaths, publishedPaths: publicationPaths, createdDirectories: Type.Array(path, { maxItems: 5120, uniqueItems: true }),
  operationDigest: Type.Union([hash, Type.Null()]), diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  stopRequested: Type.Optional(Type.Boolean()),
  acceptance: object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, reviewDigest: hash, authorityDigest: hash }),
});
export const SandboxPublicationSchema = Type.Union([SandboxPublicationV1Schema,
  object({ ...SandboxPublicationV1Schema.properties, version: Type.Literal(2), repositories: SandboxRepositoriesSchema, repositoryId: id })]);
export function projectSandboxPublication(previous: SandboxPublication | undefined, value: unknown): SandboxPublication {
  function fail(message: string): never { throw new MoguriError("sandbox_publication_corrupt", `${message} State was preserved; no source authority was adopted.`, 409); }
  if (!Value.Check(SandboxPublicationSchema, value)) fail("Native publication has an unsupported shape/version.");
  const next = value;
  if (next.version === 2) {
    const repositories = sandboxRepositories(next.repositories);
    if (!repositories.some((entry) => entry.projectId === next.repositoryId && entry.projectId === next.projectId && entry.root.root === next.root) ||
      next.workspaceId !== null) fail("Group publication must bind one exact original captured member, never a base-worktree fallback.");
  }
  const relative = (name: string) => name.isWellFormed() && !name.startsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(name) && !name.split("/").some((part) => !part || part === "." || part === "..");
  const prefix = (before: string[], after: string[]) => before.length <= after.length && before.every((name, index) => name === after[index]);
  if (!next.root.startsWith("/") || !next.root.isWellFormed() || /[\0\r\n]/.test(next.root) || !next.paths.every(relative) ||
    new Set(next.paths.map((path) => path.normalize("NFC").toLowerCase())).size !== next.paths.length ||
    !prefix(next.attemptedPaths, next.paths) || !prefix(next.publishedPaths, next.attemptedPaths) ||
    next.createdDirectories.some((path) => !relative(path) || !next.paths.some((file) => file.startsWith(`${path}/`)))) fail("Native publication path, root or effect ordering changed.");
  if (next.acceptance.commandId !== next.commandId || next.acceptance.commandDigest !== next.commandDigest ||
    ![next.createdAt, next.updatedAt].every((time) => Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time)) fail("Native publication lost actual-user acceptance or exact timestamp provenance.");
  if (next.status === "completed" && (next.operationDigest === null || next.publishedPaths.length !== next.paths.length || next.diagnostic !== null || next.stopRequested) ||
    next.status !== "completed" && next.operationDigest !== null ||
    next.status === "publishing" && next.diagnostic !== null ||
    ["failed", "stopped", "partial"].includes(next.status) && next.diagnostic === null ||
    ["failed", "stopped"].includes(next.status) && (next.attemptedPaths.length || next.createdDirectories.length)) fail("Native publication outcome hides possible effects or lacks its complete retained result.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "publishing" || next.attemptedPaths.length || next.publishedPaths.length || next.createdDirectories.length || next.stopRequested) fail("Native publication must begin with its original effect-free user intent.");
  } else {
    const immutable = ["version", "id", "profileId", "projectId", "workspaceId", "executionId", "sourceSessionId", "root", "inputDigest", "resultDigest", "documentDigest", "createdAt", "jobId", "commandId", "commandDigest"] as const;
    if (previous.status !== "publishing" || next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      previous.repositoryId !== ("repositoryId" in next ? next.repositoryId : undefined) ||
      JSON.stringify(previous.repositories) !== JSON.stringify("repositories" in next ? next.repositories : undefined) ||
      JSON.stringify(previous.paths) !== JSON.stringify(next.paths) || JSON.stringify(previous.acceptance) !== JSON.stringify(next.acceptance) ||
      !prefix(previous.attemptedPaths, next.attemptedPaths) || !prefix(previous.publishedPaths, next.publishedPaths) ||
      !prefix(previous.createdDirectories, next.createdDirectories) || previous.stopRequested && !next.stopRequested) fail("Native publication original review/ownership/effects were changed or terminal work was replayed.");
  }
  return structuredClone(next);
}
export interface SandboxPublicationPreview {
  digest: string; document: SandboxPublicationDocument; diagnostic: string;
  limits: { files: number; patchBytes: number; documentBytes: number };
}
export const SandboxPublicationResultSchema = object({
  format: Type.Literal("moguri-native-publication-result"), version: Type.Literal(1), publicationId: id, root: path,
  files: Type.Array(object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }) }), { minItems: 1, maxItems: 20 }),
});
export type SandboxPublicationResult = Static<typeof SandboxPublicationResultSchema>;
export const SandboxCommandSchema = Type.Union([
  SandboxSetupCommandSchema,
  object({ type: Type.Literal("sandbox.probe"), confirm: Type.Literal(true) }),
  object({ type: Type.Literal("sandbox.prepare"), sessionId: id, paths: Type.Array(path, { maxItems: 200, uniqueItems: true }), expectedDigest: hash, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("sandbox.reconcile"), executionId: id, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("sandbox.stop"), executionId: id }),
  object({ type: Type.Literal("sandbox.publish"), executionId: id, paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }),
    expectedDigest: hash, expectedRevision: revision, confirm: Type.Literal(true), repository: Type.Optional(id) }),
]);
export type SandboxCommand = Static<typeof SandboxCommandSchema>;
export const isSandboxCommand = (value: unknown): value is SandboxCommand => Value.Check(SandboxCommandSchema, value);
export const SandboxQuerySchema = Type.Union([
  SandboxSetupQuerySchema,
  object({ type: Type.Literal("sandbox.preview"), sessionId: id, paths: Type.Array(path, { maxItems: 200, uniqueItems: true }) }),
  object({ type: Type.Literal("sandbox.execution"), executionId: id }),
  object({ type: Type.Literal("sandbox.result"), executionId: id }),
  object({ type: Type.Literal("sandbox.publication.preview"), executionId: id, paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }), repository: Type.Optional(id) }),
  object({ type: Type.Literal("sandbox.publication"), publicationId: id }),
]);
export type SandboxQuery = Static<typeof SandboxQuerySchema>;
export const isSandboxQuery = (value: unknown): value is SandboxQuery => Value.Check(SandboxQuerySchema, value);
export type SandboxResponse =
  | SandboxSetupResponse
  | { type: "sandbox.preview"; preview: SandboxWorkspacePreview }
  | { type: "sandbox.execution"; execution: SandboxExecution }
  | { type: "sandbox.result"; result: SandboxResult | null }
  | { type: "sandbox.publication.preview"; preview: SandboxPublicationPreview }
  | { type: "sandbox.publication"; publication: SandboxPublication; document: SandboxPublicationDocument; job: CapabilityJob | null; operation: SandboxPublicationResult | null };
