import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ModelCatalogue } from "./providers.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$" });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const bytes = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const path = Type.String({ minLength: 2, maxLength: 4096, pattern: "^(?:/|[A-Za-z]:[\\\\/])[^\\u0000-\\u001f\\u007f]+$" });
const version = Type.String({ minLength: 1, maxLength: 64, pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" });
const driverVersion = Type.String({ minLength: 1, maxLength: 64, pattern: "^\\d+(?:\\.\\d+){1,3}$" });

export const LocalRuntimeKindSchema = Type.Union([Type.Literal("ollama"), Type.Literal("llama-cpp"), Type.Literal("ds4")]);
export type LocalRuntimeKind = Static<typeof LocalRuntimeKindSchema>;
export const ReadinessOperatingSystemSchema = Type.Union([
  Type.Literal("darwin"), Type.Literal("linux"), Type.Literal("win32"), Type.Literal("freebsd"),
  Type.Literal("openbsd"), Type.Literal("netbsd"), Type.Literal("aix"), Type.Literal("sunos"), Type.Literal("android"),
]);
export type ReadinessOperatingSystem = Static<typeof ReadinessOperatingSystemSchema>;
export const ReadinessArchitectureSchema = Type.Union([
  Type.Literal("arm64"), Type.Literal("x64"), Type.Literal("ia32"), Type.Literal("arm"),
  Type.Literal("ppc64"), Type.Literal("s390x"), Type.Literal("riscv64"), Type.Literal("loong64"),
]);
export type ReadinessArchitecture = Static<typeof ReadinessArchitectureSchema>;
export const ReadinessAcceleratorSchema = Type.Union([
  Type.Literal("cpu"), Type.Literal("metal"), Type.Literal("cuda"), Type.Literal("rocm"),
  Type.Literal("vulkan"), Type.Literal("opencl"),
]);
export type ReadinessAccelerator = Static<typeof ReadinessAcceleratorSchema>;
export const ModelReadinessModeSchema = Type.Union([Type.Literal("informational"), Type.Literal("required")]);
export type ModelReadinessMode = Static<typeof ModelReadinessModeSchema>;
export const LocalRuntimeConfigurationSchema = object({
  kind: Type.Optional(LocalRuntimeKindSchema), executablePath: Type.Optional(path), modelPath: Type.Optional(path),
});
export type LocalRuntimeConfiguration = Static<typeof LocalRuntimeConfigurationSchema>;
export const ModelRequirementsSchema = object({
  provenance: object({
    kind: Type.Literal("user-supplied-model-requirements"), actor: Type.Literal("user"),
    sourceDigest: digest, recordedAt: time,
  }),
  runtimeKinds: Type.Optional(Type.Array(LocalRuntimeKindSchema, { minItems: 1, maxItems: 3, uniqueItems: true })),
  minimumRuntimeVersion: Type.Optional(version),
  minimumRuntimeBuild: Type.Optional(Type.Integer({ minimum: 0, maximum: 999_999_999_999 })),
  operatingSystems: Type.Optional(Type.Array(ReadinessOperatingSystemSchema, { minItems: 1, maxItems: 9, uniqueItems: true })),
  architectures: Type.Optional(Type.Array(ReadinessArchitectureSchema, { minItems: 1, maxItems: 8, uniqueItems: true })),
  accelerator: Type.Optional(ReadinessAcceleratorSchema), minimumDriverVersion: Type.Optional(driverVersion),
  minimumRamBytes: Type.Optional(bytes), minimumFreeRamBytes: Type.Optional(bytes),
  minimumVramBytes: Type.Optional(bytes), minimumFreeVramBytes: Type.Optional(bytes),
  minimumDiskBytes: Type.Optional(bytes), minimumFreeDiskBytes: Type.Optional(bytes),
  modelFormat: Type.Optional(Type.Union([Type.Literal("gguf"), Type.Literal("safetensors")])), minimumModelBytes: Type.Optional(bytes),
  maximumModelBytes: Type.Optional(bytes), modelSha256: Type.Optional(digest),
});
export type ModelRequirements = Static<typeof ModelRequirementsSchema>;
export const ModelReadinessQuerySchema = object({
  type: Type.Literal("model.readiness"), sessionId: id, modelId: id, mode: Type.Optional(ModelReadinessModeSchema),
  runtimeReviewId: Type.Optional(id),
});
export type ModelReadinessQuery = Static<typeof ModelReadinessQuerySchema>;

export const ReadinessEvidenceSchema = object({
  kind: Type.Union([Type.Literal("observed"), Type.Literal("declared"), Type.Literal("estimated"), Type.Literal("unknown")]),
  source: Type.Union([
    Type.Literal("node-os"), Type.Literal("node-statfs"), Type.Literal("fixed-file-metadata"),
    Type.Literal("executable-header"), Type.Literal("model-header"), Type.Literal("reviewed-runtime-version"),
    Type.Literal("macos-displays"), Type.Literal("nvidia-smi"), Type.Literal("requirements"), Type.Literal("not-probed"),
  ]),
  code: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-z][a-z0-9-]*$" }),
  detail: Type.String({ minLength: 1, maxLength: 512 }),
});
export type ReadinessEvidence = Static<typeof ReadinessEvidenceSchema>;
const factStatus = Type.Union([Type.Literal("observed"), Type.Literal("unknown")]);
export const ReadinessNumberFactSchema = object({
  status: factStatus, value: Type.Union([bytes, Type.Null()]), evidence: ReadinessEvidenceSchema,
});
export type ReadinessNumberFact = Static<typeof ReadinessNumberFactSchema>;
export const ReadinessTextFactSchema = object({
  status: factStatus, value: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]), evidence: ReadinessEvidenceSchema,
});
export type ReadinessTextFact = Static<typeof ReadinessTextFactSchema>;
export const ReadinessFileFactSchema = object({
  status: Type.Union([Type.Literal("observed"), Type.Literal("missing"), Type.Literal("unknown"), Type.Literal("refused")]),
  sizeBytes: Type.Union([bytes, Type.Null()]), sha256: Type.Union([digest, Type.Null()]),
  identityDigest: Type.Union([digest, Type.Null()]), evidence: ReadinessEvidenceSchema,
});
export type ReadinessFileFact = Static<typeof ReadinessFileFactSchema>;
export const RuntimeReadinessObservationSchema = object({
  kind: LocalRuntimeKindSchema, source: Type.Union([Type.Literal("configured"), Type.Literal("known-location")]),
  locationDigest: digest, executable: ReadinessFileFactSchema, version: ReadinessTextFactSchema,
  binary: object({
    format: Type.Union([Type.Literal("mach-o"), Type.Literal("elf"), Type.Literal("pe"), Type.Literal("unknown")]),
    architectures: Type.Array(ReadinessArchitectureSchema, { maxItems: 8, uniqueItems: true }), evidence: ReadinessEvidenceSchema,
  }),
});
export type RuntimeReadinessObservation = Static<typeof RuntimeReadinessObservationSchema>;
export const ReadinessAcceleratorObservationSchema = object({
  kind: ReadinessAcceleratorSchema, slot: Type.Integer({ minimum: 0, maximum: 15 }),
  support: Type.Union([Type.Literal("observed"), Type.Literal("missing"), Type.Literal("unknown")]),
  memoryKind: Type.Union([Type.Literal("dedicated"), Type.Literal("unified"), Type.Literal("unknown")]),
  driverVersion: ReadinessTextFactSchema, vramBytes: ReadinessNumberFactSchema,
  freeVramBytes: ReadinessNumberFactSchema, evidence: ReadinessEvidenceSchema,
});
export type ReadinessAcceleratorObservation = Static<typeof ReadinessAcceleratorObservationSchema>;
export const ModelReadinessObservationsSchema = object({
  host: object({
    operatingSystem: ReadinessTextFactSchema, architecture: ReadinessTextFactSchema, osRelease: ReadinessTextFactSchema,
    ramBytes: ReadinessNumberFactSchema, freeRamBytes: ReadinessNumberFactSchema,
    diskBytes: ReadinessNumberFactSchema, freeDiskBytes: ReadinessNumberFactSchema,
  }),
  runtime: Type.Union([RuntimeReadinessObservationSchema, Type.Null()]),
  discovered: Type.Array(RuntimeReadinessObservationSchema, { maxItems: 12 }),
  model: Type.Union([object({
    file: ReadinessFileFactSchema, format: ReadinessTextFactSchema,
    formatVersion: Type.Union([Type.Integer({ minimum: 0, maximum: 0xffffffff }), Type.Null()]),
  }), Type.Null()]),
  accelerators: Type.Array(ReadinessAcceleratorObservationSchema, { maxItems: 16 }),
  acceleratorEvidence: ReadinessEvidenceSchema,
});
export type ModelReadinessObservations = Static<typeof ModelReadinessObservationsSchema>;
export const ModelReadinessCheckSchema = object({
  id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9-]*$" }),
  status: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unknown"), Type.Literal("not-requested")]),
  required: Type.Boolean(), observed: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
  expected: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
  evidence: ReadinessEvidenceSchema,
});
export type ModelReadinessCheck = Static<typeof ModelReadinessCheckSchema>;
export const ModelReadinessEvaluationSchema = object({
  status: Type.Union([Type.Literal("satisfied"), Type.Literal("incompatible"), Type.Literal("unknown")]),
  requiredSatisfied: Type.Union([Type.Boolean(), Type.Null()]),
  checks: Type.Array(ModelReadinessCheckSchema, { maxItems: 32 }),
});
export type ModelReadinessEvaluation = Static<typeof ModelReadinessEvaluationSchema>;

export const ModelReadinessTargetSchema = object({
  profileId: id, sessionId: id, modelId: id,
  env: Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]),
  rootDigest: digest, peerDigest: Type.Union([digest, Type.Null()]), buildDigest: digest,
  endpointBindingDigest: digest, modelBindingDigest: digest,
});
export type ModelReadinessTarget = Static<typeof ModelReadinessTargetSchema>;
export const ModelReadinessCollectionInputSchema = object({
  target: ModelReadinessTargetSchema, storagePath: path, runtime: Type.Optional(LocalRuntimeConfigurationSchema),
  requirements: Type.Optional(ModelRequirementsSchema), mode: Type.Optional(ModelReadinessModeSchema),
});
export type ModelReadinessCollectionInput = Static<typeof ModelReadinessCollectionInputSchema>;
export const ModelReadinessEvaluationInputSchema = object({
  observations: ModelReadinessObservationsSchema, requirements: Type.Optional(ModelRequirementsSchema), mode: Type.Optional(ModelReadinessModeSchema),
});
export type ModelReadinessEvaluationInput = Static<typeof ModelReadinessEvaluationInputSchema>;
export const ModelReadinessProbeLimitsSchema = object({
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  probeTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 3000 })),
  maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 128 * 1024 })),
  maxExecutableBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 128 * 1024 * 1024 })),
  maxAgeMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000 })),
});
export type ModelReadinessProbeLimits = Static<typeof ModelReadinessProbeLimitsSchema>;
export const LocalRuntimeExecutableReviewSchema = object({
  kind: Type.Literal("retained-user-runtime-executable-review"), actor: Type.Literal("user"),
  runtimeKind: LocalRuntimeKindSchema, configurationDigest: digest, target: ModelReadinessTargetSchema,
  executableLocationDigest: digest, executableSha256: digest, executableIdentityDigest: digest,
  reviewDigest: digest, reviewedAt: time,
});
export type LocalRuntimeExecutableReview = Static<typeof LocalRuntimeExecutableReviewSchema>;
export const ModelRuntimePreviewQuerySchema = object({
  type: Type.Literal("model.runtime.preview"), sessionId: id, modelId: id,
});
export type ModelRuntimePreviewQuery = Static<typeof ModelRuntimePreviewQuerySchema>;
export const ModelRuntimePreviewSchema = object({
  format: Type.Literal("moguri-runtime-executable-preview"), version: Type.Literal(1), digest,
  target: ModelReadinessTargetSchema, runtimeKind: Type.Literal("llama-cpp"), configurationDigest: digest,
  program: object({ executablePath: path, args: Type.Tuple([Type.Literal("--version")]), cwd: Type.Literal("/") }),
  executableLocationDigest: digest, executableSha256: digest, executableIdentityDigest: digest,
  warning: Type.String({ minLength: 1, maxLength: 512 }),
});
export type ModelRuntimePreview = Static<typeof ModelRuntimePreviewSchema>;
export interface ModelRuntimePreviewResponse { type: "model.runtime.preview"; preview: ModelRuntimePreview }
export const ModelRuntimeReviewCommandSchema = object({
  type: Type.Literal("model.runtime.review"), sessionId: id, modelId: id, expectedDigest: digest,
});
export type ModelRuntimeReviewCommand = Static<typeof ModelRuntimeReviewCommandSchema>;
export const ModelRuntimeReviewRecordSchema = object({
  version: Type.Literal(1), id, review: LocalRuntimeExecutableReviewSchema,
});
export type ModelRuntimeReviewRecord = Static<typeof ModelRuntimeReviewRecordSchema>;
export const ModelRuntimeReviewConsumptionSchema = object({
  version: Type.Literal(1), reviewId: id, requestId: id, actor: Type.Literal("user"), target: ModelReadinessTargetSchema,
});
export type ModelRuntimeReviewConsumption = Static<typeof ModelRuntimeReviewConsumptionSchema>;
export const ModelReadinessReportSchema = object({
  format: Type.Literal("moguri-model-readiness"), version: Type.Literal(1), readOnly: Type.Literal(true),
  target: ModelReadinessTargetSchema, mode: ModelReadinessModeSchema, configurationDigest: digest,
  configuration: object({
    kind: Type.Union([LocalRuntimeKindSchema, Type.Null()]),
    executableLocationDigest: Type.Union([digest, Type.Null()]), modelLocationDigest: Type.Union([digest, Type.Null()]),
  }),
  requirements: Type.Union([ModelRequirementsSchema, Type.Null()]),
  observations: ModelReadinessObservationsSchema, evaluation: ModelReadinessEvaluationSchema,
  freshness: object({ observedAt: time, expiresAt: time, maxAgeMs: Type.Integer({ minimum: 1, maximum: 300_000 }) }),
  capacity: object({
    status: Type.Literal("unknown"), estimatedMaxParameters: Type.Null(), evidence: ReadinessEvidenceSchema,
  }),
  warnings: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 8 }),
});
export type ModelReadinessReport = Static<typeof ModelReadinessReportSchema>;
export interface ModelReadinessResponse { type: "model.readiness"; readiness: ModelReadinessReport }
export const isModelReadinessQuery = (value: unknown): value is ModelReadinessQuery => Value.Check(ModelReadinessQuerySchema, value);
export const isModelReadinessReport = (value: unknown): value is ModelReadinessReport => Value.Check(ModelReadinessReportSchema, value);
export function modelReadinessTargetsMatch(left: ModelReadinessTarget, right: ModelReadinessTarget): boolean {
  return left.profileId === right.profileId && left.sessionId === right.sessionId && left.modelId === right.modelId &&
    left.env === right.env && left.rootDigest === right.rootDigest && left.peerDigest === right.peerDigest &&
    left.buildDigest === right.buildDigest && left.endpointBindingDigest === right.endpointBindingDigest &&
    left.modelBindingDigest === right.modelBindingDigest;
}
export function isModelReadinessReportCurrent(report: ModelReadinessReport, target: ModelReadinessTarget, now = Date.now()): boolean {
  if (!isModelReadinessReport(report) || !Value.Check(ModelReadinessTargetSchema, target) || !Number.isFinite(now) ||
    !modelReadinessTargetsMatch(report.target, target)) return false;
  const observed = Date.parse(report.freshness.observedAt), expires = Date.parse(report.freshness.expiresAt);
  return Number.isFinite(observed) && Number.isFinite(expires) && observed <= now && now < expires &&
    new Date(observed).toISOString() === report.freshness.observedAt && new Date(expires).toISOString() === report.freshness.expiresAt &&
    expires - observed === report.freshness.maxAgeMs;
}
export function configuredReadinessModels(catalogue: ModelCatalogue | undefined, env: ModelReadinessTarget["env"]) {
  const providers = new Set(catalogue?.providers.filter((provider) => provider.enabled && provider.endpointId &&
    (provider.scope === "remote") === (env === "Remote")).map((provider) => provider.id));
  return catalogue?.models.flatMap((entry) => entry.offerings)
    .filter((offering) => offering.model.source === "local" && typeof offering.model.providerId === "string" && providers.has(offering.model.providerId))
    .map((offering) => offering.model) ?? [];
}
