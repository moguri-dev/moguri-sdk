import { Type, type Static } from "typebox";
import { MAX_TEXT, PROTOCOL_VERSION, ProjectSettingsSchema } from "../../../packages/protocol/src/index.ts";
import { WorkerRequestSchema, WorkspaceRewindInspectionSchema } from "./worker-protocol.ts";
import { RemoteMcpToolsRequestSchema } from "./remote-mcp-runtime.ts";
import { McpToolInfoSchema } from "../../../packages/protocol/src/mcp.ts";
import { RemoteTerminalBuildSchema } from "../../../packages/protocol/src/terminals.ts";
import { SourceFrameSchema, SourceRequestSchema, SourceValidationRequestSchema, SourceValidationResultSchema } from "./repository-source.ts";
import { CheckpointFileSchema, RemoteCheckpointRootSchema, WinddownCommitDocumentSchema, WinddownCommitResultSchema } from "../../../packages/protocol/src/winddown.ts";
import { ModelReadinessTransportRequestSchema, ModelReadinessTransportResultSchema } from "../../../packages/protocol/src/model-readiness-transport.ts";
import { CheckpointWorkspaceSchema } from "../../../packages/protocol/src/turn-checkpoints.ts";
import { CheckpointRestorePlanSchema } from "../../../packages/protocol/src/checkpoint-transports.ts";
import { SkillPackageRequestSchema } from "./remote-skill-package.ts";

const runId = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sequence = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableText = Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]);
const path = Type.String({ minLength: 1, maxLength: 4096 });
const RepositoryApiMetadataSchema = Type.Object({
  id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), name: Type.String({ minLength: 1, maxLength: 100 }),
  full_name: Type.String({ minLength: 1, maxLength: 256 }), html_url: Type.String({ maxLength: 512 }),
  owner: Type.Object({ login: Type.String({ minLength: 1, maxLength: 128 }), type: Type.Union([Type.Literal("User"), Type.Literal("Organization")]) }, { additionalProperties: false }),
  private: Type.Boolean(), visibility: Type.Union([Type.Literal("public"), Type.Literal("private"), Type.Literal("internal")]),
  license: Type.Object({ spdx_id: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]) }, { additionalProperties: false }),
}, { additionalProperties: false });
export const WorkspaceReadQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("checkpoint.capture") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("checkpoint.rewind.inspect"), plan: CheckpointRestorePlanSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("checkpoint.source"), paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }),
    branch: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.files"), path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.file"), path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.git"), diff: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("plan.read") }, { additionalProperties: false }),
]);
export const WorkspaceReadRequestSchema = Type.Object({
  query: WorkspaceReadQuerySchema,
  policy: Type.Object({
    deniedFolders: Type.Array(path, { maxItems: 100 }), planPath: path,
    upstream: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$" }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export const WorkspaceReadResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("checkpoint.capture"), workspace: CheckpointWorkspaceSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("checkpoint.rewind.inspect"), inspection: WorkspaceRewindInspectionSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("checkpoint.source"), source: Type.Omit(RemoteCheckpointRootSchema, ["env", "projectId", "workspaceId"]),
    files: Type.Array(CheckpointFileSchema, { minItems: 1, maxItems: 20 }), sourceStateDigest: hash }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.files"), path, entries: Type.Array(path, { maxItems: 1000 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.file"), path, text: Type.String({ maxLength: MAX_TEXT }), digest: hash, bytes: Type.Integer({ minimum: 0, maximum: MAX_TEXT }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("session.git"), branch: Type.String({ maxLength: 4096 }), repository: nullableText, status: Type.String({ maxLength: 512 * 1024 }), diff: Type.String({ maxLength: 512 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("plan.read"), path, text: Type.String({ maxLength: MAX_TEXT }), digest: Type.String({ pattern: "^(absent|[a-f0-9]{64})$" }), exists: Type.Boolean() }, { additionalProperties: false }),
]);
export type WorkspaceReadQuery = Static<typeof WorkspaceReadQuerySchema>;
export type WorkspaceReadRequest = Static<typeof WorkspaceReadRequestSchema>;
export type WorkspaceReadResult = Static<typeof WorkspaceReadResultSchema>;
const catalog = Type.Object({
  url: Type.String({ maxLength: 4096 }), key: Type.Union([Type.String({ maxLength: 32768 }), Type.Null()]),
  headers: Type.Optional(Type.Record(Type.String({ maxLength: 128 }), Type.Union([Type.String({ maxLength: 32768 }), Type.Null()]), { maxProperties: 32 })),
}, { additionalProperties: false });
export const NativeRepositoryRootsSchema = Type.Array(Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 128 }), name: Type.String({ minLength: 1, maxLength: 128 }),
  root: Type.String({ pattern: "^/workspace/repositories/[a-f0-9]{64}$" }),
}, { additionalProperties: false }), { minItems: 1, maxItems: 1000 });
export const ForegroundQuerySchema = Type.Object({
  kind: Type.Literal("query"), requestId: Type.String({ minLength: 1, maxLength: 128 }),
  query: Type.Union([
    ModelReadinessTransportRequestSchema,
    Type.Object({ type: Type.Literal("catalog"), catalog }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("context"), settings: ProjectSettingsSchema, repository: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
export type ForegroundQuery = Static<typeof ForegroundQuerySchema>;
export const ForegroundQueryCancellationSchema = Type.Object({
  kind: Type.Literal("query-cancel"), requestId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export const BridgeInitSchema = Type.Object({
  action: Type.Union([Type.Literal("probe"), Type.Literal("catalog"), Type.Literal("context"), Type.Literal("workspace"), Type.Literal("repository"), Type.Literal("memory"), Type.Literal("mcp-tools"), Type.Literal("start"), Type.Literal("attach"), Type.Literal("inspect"), Type.Literal("checkpoint"), Type.Literal("checkpoint-inspect"), Type.Literal("model-readiness"), Type.Literal("skill-package")]),
  protocol: Type.Literal(PROTOCOL_VERSION), workerDigest: hash,
  stateDir: Type.String({ minLength: 1, maxLength: 4096 }), root: nullableText,
  runId: Type.Optional(runId), key: Type.Optional(hash), after: Type.Optional(sequence),
  journal: Type.Optional(Type.Literal(true)),
  sealed: Type.Optional(Type.Literal(true)),
  nativeNetworkProbe: Type.Optional(Type.Literal(true)),
  nativeRepositories: Type.Optional(NativeRepositoryRootsSchema),
  catalog: Type.Optional(catalog),
  context: Type.Optional(ProjectSettingsSchema),
  workspace: Type.Optional(WorkspaceReadRequestSchema),
  repository: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  memory: Type.Optional(Type.Union([SourceRequestSchema, SourceValidationRequestSchema])),
  mcpTools: Type.Optional(RemoteMcpToolsRequestSchema),
  checkpoint: Type.Optional(Type.Object({ document: WinddownCommitDocumentSchema, settings: ProjectSettingsSchema }, { additionalProperties: false })),
  modelReadiness: Type.Optional(ModelReadinessTransportRequestSchema),
  readinessPeerDigest: Type.Optional(hash),
  /** Protocol 111: one exact admitted skill package to write into the remote Moguri state's content-addressed skill cache. */
  skillPackage: Type.Optional(SkillPackageRequestSchema),
}, { additionalProperties: false });
const BridgeInfoSchema = Type.Object({ protocol: Type.Literal(PROTOCOL_VERSION), workerDigest: hash, nodeVersion: Type.String(), platform: Type.String(), root: nullableText,
  native: Type.Optional(Type.Object({ bridgeDigest: hash, uid: Type.Integer({ minimum: 0 }), noNewPrivs: Type.Integer({ minimum: 0 }), seccomp: Type.Integer({ minimum: 0 }),
    capabilities: Type.String({ pattern: "^[a-fA-F0-9]{1,64}$" }), enforcedProxy: Type.Boolean(),
    repositories: Type.Optional(NativeRepositoryRootsSchema),
    networkProbe: Type.Optional(Type.Object({ url: Type.Literal("https://api.githubcopilot.com"), status: Type.Integer({ minimum: 100, maximum: 599 }) }, { additionalProperties: false })) }, { additionalProperties: false })),
  terminalBuild: Type.Optional(RemoteTerminalBuildSchema), terminalDiagnostic: Type.Optional(Type.String({ maxLength: 4096 })) }, { additionalProperties: false });
const SavedBridgeInfoSchema = Type.Object({
  ...BridgeInfoSchema.properties, protocol: Type.Integer({ minimum: 16, maximum: PROTOCOL_VERSION }),
}, { additionalProperties: false });
const BridgeStatusSchema = Type.Object({
  runId, workerPid: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  port: Type.Integer({ minimum: 0, maximum: 65535 }), acknowledged: sequence, sequence,
  status: Type.Union([Type.Literal("launching"), Type.Literal("running"), Type.Literal("stopping"), Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial"), Type.Literal("unconfirmed")]),
  cancellation: Type.Union([Type.Literal("none"), Type.Literal("requested"), Type.Literal("acknowledged"), Type.Literal("unconfirmed")]),
  cleanup: Type.Union([Type.Literal("pending"), Type.Literal("owned-worker-stopped"), Type.Literal("unconfirmed")]), diagnostic: nullableText,
}, { additionalProperties: false });
const BridgeFrameSchema = Type.Object({ kind: Type.Literal("frame"), sequence, digest: hash, request: WorkerRequestSchema }, { additionalProperties: false });
export const SavedStatusSchema = Type.Object({ status: BridgeStatusSchema, info: SavedBridgeInfoSchema, proof: hash }, { additionalProperties: false });
export const BridgeEnvelopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("model-readiness"), info: BridgeInfoSchema, result: ModelReadinessTransportResultSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("checkpoint"), info: BridgeInfoSchema, result: WinddownCommitResultSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("checkpoint-inspection"), info: BridgeInfoSchema, status: BridgeStatusSchema, frames: Type.Array(BridgeFrameSchema, { maxItems: 8 }),
    actualCommit: Type.Union([Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), Type.Null()]), operationSettled: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("query-result"), runId, requestId: Type.String({ minLength: 1, maxLength: 128 }), result: Type.Union([
    ModelReadinessTransportResultSchema,
    Type.Object({ type: Type.Literal("catalog"), status: Type.Integer({ minimum: 100, maximum: 599 }), body: Type.String({ maxLength: 512 * 1024 }) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("context"), text: Type.String({ maxLength: 256 * 1024 }) }, { additionalProperties: false }),
  ]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("query-error"), runId, requestId: Type.String({ minLength: 1, maxLength: 128 }), code: Type.String({ maxLength: 128 }), message: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("bootstrap"), protocol: Type.Literal(PROTOCOL_VERSION) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("probe"), info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("skill-package"), info: BridgeInfoSchema, digest: hash, path, files: Type.Array(path, { minItems: 1, maxItems: 128 }), reused: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("ready"), info: BridgeInfoSchema, status: BridgeStatusSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("status"), status: BridgeStatusSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("catalog"), status: Type.Integer({ minimum: 100, maximum: 599 }), body: Type.String({ maxLength: 512 * 1024 }), info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("context"), text: Type.String({ maxLength: 256 * 1024 }), info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("workspace"), result: WorkspaceReadResultSchema, info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("repository"), repository: Type.String({ minLength: 1, maxLength: 512 }), metadata: RepositoryApiMetadataSchema, info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("memory"), frame: SourceFrameSchema, info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("memory-validation"), result: SourceValidationResultSchema, info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("mcp-tools"), tools: Type.Array(McpToolInfoSchema, { maxItems: 512 }), helperDigest: hash, info: BridgeInfoSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("inspection"), ...SavedStatusSchema.properties, frames: Type.Array(BridgeFrameSchema, { maxItems: 128 }), nextSequence: sequence }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String({ maxLength: 4096 }), code: Type.Optional(Type.String({ maxLength: 128 })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("stderr"), text: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }),
  BridgeFrameSchema,
]);
export type BridgeEnvelope = Static<typeof BridgeEnvelopeSchema>;
export type BridgeInit = Static<typeof BridgeInitSchema>;
export type BridgeInfo = Static<typeof BridgeInfoSchema>;
export type BridgeStatus = Static<typeof BridgeStatusSchema>;
export type BridgeFrame = Static<typeof BridgeFrameSchema>;
export type SavedStatus = Static<typeof SavedStatusSchema>;
