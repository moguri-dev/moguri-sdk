import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const revision = Type.Integer({ minimum: 0 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const OtlpInputSchema = object({
  enabled: Type.Boolean(), endpoint: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  samplingRatio: Type.Number({ minimum: 0, maximum: 1 }),
});
export type OtlpInput = Static<typeof OtlpInputSchema>;
export const OtlpConfigurationSchema = object({ ...OtlpInputSchema.properties, revision, disclosureVersion: Type.Literal(1) });
export type OtlpConfiguration = Static<typeof OtlpConfigurationSchema>;
export const defaultOtlpConfiguration = (): OtlpConfiguration => ({ enabled: false, endpoint: null, samplingRatio: 1, revision: 0, disclosureVersion: 1 });
export const OtlpReviewSchema = object({
  ...OtlpInputSchema.properties, profileId: Type.String({ minLength: 1, maxLength: 128 }), revision,
  transport: Type.Literal("otlp-http-json"), signals: Type.Tuple([Type.Literal("traces"), Type.Literal("metrics")]),
  disclosureVersion: Type.Literal(1), digest: hash,
});
export type OtlpReview = Static<typeof OtlpReviewSchema>;
export const OtlpQuerySchema = Type.Union([
  object({ type: Type.Literal("telemetry.export.status") }),
  object({ type: Type.Literal("telemetry.export.review"), input: OtlpInputSchema }),
]);
export type OtlpQuery = Static<typeof OtlpQuerySchema>;
export const isOtlpQuery = (value: unknown): value is OtlpQuery => Value.Check(OtlpQuerySchema, value);
export const OtlpCommandSchema = object({ type: Type.Literal("telemetry.export.configure"), review: OtlpReviewSchema, confirm: Type.Literal(true) });
export type OtlpCommand = Static<typeof OtlpCommandSchema>;
export const OTLP_LIMITS = Object.freeze({ queuedSpans: 128, batchSpans: 32, requestBytes: 65_536,
  responseBytes: 4096, requestMs: 1500, batchMs: 1000, shutdownMs: 2000, attempts: 1 });
export interface OtlpExportStatus {
  configuration: OtlpConfiguration;
  phase: "disabled" | "idle" | "exporting" | "degraded" | "closing";
  queuedSpans: number; acceptedSpans: number; droppedSpans: number; sampledOut: number; failedRequests: number;
  lastFailure: { code: "timeout" | "network" | "http" | "response" | "partial" | "capacity" | "shutdown" | "encoding" | "cancelled"; httpStatus: number | null } | null;
  limits: typeof OTLP_LIMITS;
}
export type OtlpResponse =
  | ({ type: "telemetry.export.status" } & OtlpExportStatus)
  | { type: "telemetry.export.review"; review: OtlpReview };

export function canonicalOtlpInput(input: OtlpInput): OtlpInput {
  if (!Value.Check(OtlpInputSchema, input)) throw new MoguriError("otlp_configuration", "Choose valid OTLP metadata-export settings.");
  if (input.endpoint === null) {
    if (input.enabled) throw new MoguriError("otlp_endpoint", "Enabling OTLP metadata export requires an explicit reviewed collector origin.");
    return { enabled: false, endpoint: null, samplingRatio: input.samplingRatio };
  }
  let url: URL;
  try { url = new URL(input.endpoint); }
  catch { throw new MoguriError("otlp_endpoint", "Use an HTTPS collector origin or literal loopback HTTP origin, without credentials, paths, query or fragment."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new MoguriError("otlp_endpoint", "Use an HTTPS collector origin or literal loopback HTTP origin, without credentials, paths, query or fragment.");
  }
  return { enabled: input.enabled, endpoint: url.origin, samplingRatio: input.samplingRatio };
}
