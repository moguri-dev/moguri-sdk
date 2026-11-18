import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const revision = Type.Integer({ minimum: 0 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const OTLP_HEADER_PATTERN = "^[A-Za-z][A-Za-z0-9-]{0,63}$";
const headerName = Type.String({ pattern: OTLP_HEADER_PATTERN });
/** Transport headers the sender owns; a credential header can never replace them. */
const reservedHeader = /^(?:content-|host$|connection$|transfer-encoding$|te$|trailer$|upgrade$|expect$|keep-alive$|proxy-|accept-encoding$|cookie$)/i;
export const OtlpInputSchema = object({
  enabled: Type.Boolean(), endpoint: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  samplingRatio: Type.Number({ minimum: 0, maximum: 1 }),
  /** Protocol 112: also export allowlisted diagnostic log records correlated with trace/span IDs. Absent means off. */
  logs: Type.Optional(Type.Boolean()),
  /** Protocol 112: names of credential headers whose values live only in this profile's secret backend, bound to the collector origin. */
  headers: Type.Optional(Type.Array(headerName, { maxItems: 8 })),
});
export type OtlpInput = Static<typeof OtlpInputSchema>;
/** Disclosure 1 covers traces and metrics only. Disclosure 2 (protocol 112) adds optional logs and secret-backend credential headers. */
export const OtlpConfigurationSchema = object({ ...OtlpInputSchema.properties, revision,
  disclosureVersion: Type.Union([Type.Literal(1), Type.Literal(2)]) });
export type OtlpConfiguration = Static<typeof OtlpConfigurationSchema>;
export const defaultOtlpConfiguration = (): OtlpConfiguration => ({ enabled: false, endpoint: null, samplingRatio: 1, revision: 0, disclosureVersion: 1 });
export const OTLP_DISCLOSURE_VERSION = 2;
/** Traces and metrics alone keep the protocol-97 disclosure and configuration shape; logs or credential headers need disclosure 2. */
export const otlpDisclosure = (input: { logs: boolean; headers: readonly string[] }): 1 | 2 => input.logs || input.headers.length ? OTLP_DISCLOSURE_VERSION : 1;
export const OtlpReviewSchema = object({
  enabled: Type.Boolean(), endpoint: OtlpInputSchema.properties.endpoint, samplingRatio: OtlpInputSchema.properties.samplingRatio,
  logs: Type.Boolean(), headers: Type.Array(headerName, { maxItems: 8 }),
  profileId: Type.String({ minLength: 1, maxLength: 128 }), revision,
  transport: Type.Literal("otlp-http-json"),
  signals: Type.Union([Type.Tuple([Type.Literal("traces"), Type.Literal("metrics")]), Type.Tuple([Type.Literal("traces"), Type.Literal("metrics"), Type.Literal("logs")])]),
  disclosureVersion: Type.Union([Type.Literal(1), Type.Literal(OTLP_DISCLOSURE_VERSION)]), digest: hash,
});
export type OtlpReview = Static<typeof OtlpReviewSchema>;
export const OtlpQuerySchema = Type.Union([
  object({ type: Type.Literal("telemetry.export.status") }),
  object({ type: Type.Literal("telemetry.export.review"), input: OtlpInputSchema }),
]);
export type OtlpQuery = Static<typeof OtlpQuerySchema>;
export const isOtlpQuery = (value: unknown): value is OtlpQuery => Value.Check(OtlpQuerySchema, value);
/** Credentials are bound to one exact collector origin and header name; changing the destination needs the value again. */
const credentialTarget = { endpoint: Type.String({ minLength: 1, maxLength: 2048 }), name: headerName };
export const OtlpCommandSchema = Type.Union([
  object({ type: Type.Literal("telemetry.export.configure"), review: OtlpReviewSchema, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("telemetry.export.credential.set"), ...credentialTarget,
    value: Type.String({ minLength: 1, maxLength: 4096, pattern: "^[\\x20-\\x7e]+$" }) }),
  object({ type: Type.Literal("telemetry.export.credential.remove"), ...credentialTarget }),
]);
export type OtlpCommand = Static<typeof OtlpCommandSchema>;
export const isOtlpCommand = (value: unknown): value is OtlpCommand => Value.Check(OtlpCommandSchema, value);
export const OTLP_LIMITS = Object.freeze({ queuedSpans: 128, batchSpans: 32, queuedLogs: 128, batchLogs: 32, requestBytes: 65_536,
  responseBytes: 4096, requestMs: 1500, batchMs: 1000, shutdownMs: 2000, attempts: 1, headers: 8, exportedSpanKeys: 4096 });
export type OtlpFailureCode = "timeout" | "network" | "http" | "response" | "partial" | "capacity" | "shutdown" | "encoding" | "cancelled" | "credential";
export interface OtlpExportStatus {
  configuration: OtlpConfiguration;
  phase: "disabled" | "idle" | "exporting" | "degraded" | "closing";
  queuedSpans: number; acceptedSpans: number; droppedSpans: number; sampledOut: number; failedRequests: number;
  /** Protocol 112 log signal counters; zero while logs are off. */
  queuedLogs: number; acceptedLogs: number; droppedLogs: number;
  /** Protocol 112: whether each configured header has a stored value for the current origin; null when the secret backend is unreadable. */
  headers: { name: string; stored: boolean | null }[];
  lastFailure: { code: OtlpFailureCode; httpStatus: number | null } | null;
  limits: typeof OTLP_LIMITS;
}
export type OtlpResponse =
  | ({ type: "telemetry.export.status" } & OtlpExportStatus)
  | { type: "telemetry.export.review"; review: OtlpReview };

function canonicalEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new MoguriError("otlp_endpoint", "Use an HTTPS collector origin or literal loopback HTTP origin, without credentials, paths, query or fragment."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new MoguriError("otlp_endpoint", "Use an HTTPS collector origin or literal loopback HTTP origin, without credentials, paths, query or fragment.");
  }
  return url.origin;
}
export function canonicalOtlpHeaders(names: readonly string[] | undefined): string[] {
  const values = (names ?? []).map((name) => name.toLowerCase());
  if (values.length > OTLP_LIMITS.headers || new Set(values).size !== values.length || values.some((name) => !new RegExp(OTLP_HEADER_PATTERN).test(name) || reservedHeader.test(name))) {
    throw new MoguriError("otlp_headers", "Use up to eight unique credential header names, such as authorization or x-api-key, that don't replace transport headers.");
  }
  return values.sort();
}
/** Returns every reviewed field explicitly; absent protocol-112 fields mean logs off and no credential headers. */
export function canonicalOtlpInput(input: OtlpInput): Required<OtlpInput> {
  if (!Value.Check(OtlpInputSchema, input)) throw new MoguriError("otlp_configuration", "Choose valid OTLP metadata-export settings.");
  const logs = input.logs ?? false, headers = canonicalOtlpHeaders(input.headers);
  if (input.endpoint === null) {
    if (input.enabled) throw new MoguriError("otlp_endpoint", "Enabling OTLP metadata export requires an explicit reviewed collector origin.");
    if (headers.length) throw new MoguriError("otlp_headers", "Credential headers need an explicit collector origin.");
    return { enabled: false, endpoint: null, samplingRatio: input.samplingRatio, logs, headers };
  }
  return { enabled: input.enabled, endpoint: canonicalEndpoint(input.endpoint), samplingRatio: input.samplingRatio, logs, headers };
}
export const otlpCredentialEndpoint = (endpoint: string): string => canonicalEndpoint(endpoint);
