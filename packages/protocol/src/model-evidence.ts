import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const declaration = Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]);
export const ModelEvidenceQuerySchema = object({ type: Type.Literal("model.evidence"), modelId: id });
export type ModelEvidenceQuery = Static<typeof ModelEvidenceQuerySchema>;
export const isModelEvidenceQuery = (value: unknown): value is ModelEvidenceQuery => Value.Check(ModelEvidenceQuerySchema, value);
export const ModelEvidenceReportSchema = object({
  format: Type.Literal("moguri-provider-model-evidence"), version: Type.Literal(1),
  modelId: id, apiModelId: id, providerId: Type.Literal("github-copilot"),
  status: Type.Union([Type.Literal("declared"), Type.Literal("unknown")]),
  source: object({ kind: Type.Literal("authenticated-provider-catalogue"), endpoint: Type.String({ minLength: 1, maxLength: 512 }), familyField: Type.Literal("capabilities.family") }),
  claimed: object({ family: declaration, vendor: declaration, version: declaration }),
  observedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" }),
  warning: Type.String({ minLength: 1, maxLength: 1000 }),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export type ModelEvidenceReport = Static<typeof ModelEvidenceReportSchema>;
export interface ModelEvidenceResponse { type: "model.evidence"; evidence: ModelEvidenceReport }
