import { Type, type Static } from "typebox";
import {
  LocalRuntimeExecutableReviewSchema, ModelReadinessCollectionInputSchema, ModelReadinessReportSchema, type ModelReadinessTarget,
} from "./model-readiness.ts";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const root = Type.Object({
  root: path, device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }),
}, { additionalProperties: false });
export const ModelReadinessBindingSchema = Type.Object({
  root: Type.Union([root, Type.Null()]), storage: Type.Union([root, Type.Null()]),
  storagePath: ModelReadinessCollectionInputSchema.properties.storagePath, buildDigest: hash,
}, { additionalProperties: false });
export type ModelReadinessBinding = Static<typeof ModelReadinessBindingSchema>;
export const ModelReadinessTransportRequestSchema = Type.Union([
  Type.Object({ type: Type.Literal("model.readiness.binding"), storagePath: Type.Optional(path) }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal("model.readiness"), input: ModelReadinessCollectionInputSchema,
    binding: ModelReadinessBindingSchema, executableReview: Type.Optional(LocalRuntimeExecutableReviewSchema),
  }, { additionalProperties: false }),
]);
export type ModelReadinessTransportRequest = Static<typeof ModelReadinessTransportRequestSchema>;
export const ModelReadinessTransportResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("model.readiness.binding"), binding: ModelReadinessBindingSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("model.readiness"), readiness: ModelReadinessReportSchema }, { additionalProperties: false }),
]);
export type ModelReadinessTransportResult = Static<typeof ModelReadinessTransportResultSchema>;
export const ModelReadinessTargetQuerySchema = Type.Object({
  type: Type.Literal("model.readiness.target"),
  sessionId: Type.String({ minLength: 1, maxLength: 128 }),
  modelId: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });
export type ModelReadinessTargetQuery = Static<typeof ModelReadinessTargetQuerySchema>;
export interface ModelReadinessTargetResponse { type: "model.readiness.target"; target: ModelReadinessTarget }
