import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ModelRoleSchema, UsageFiltersSchema, type BudgetWindow } from "./budgets.ts";
import { RepositoryAttributionSchema, RepositoryDiagnosticSchema, type RepositoryCoverage } from "./repositories.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const OperationFamilySchema = Type.Union([Type.Literal("tool"), Type.Literal("mcp")]);
export const OperationActorSchema = Type.Union([Type.Literal("model"), Type.Literal("external"), Type.Literal("unknown")]);
export const OperationOutcomeSchema = Type.Union([
  Type.Literal("pending"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("denied"),
  Type.Literal("stopped"), Type.Literal("partial"), Type.Literal("unconfirmed"), Type.Literal("unknown"),
]);
export const OperationEntrySchema = object({
  id: hash, profileId: id, revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), callHash: hash,
  sessionId: nullable(id), ownerSessionId: nullable(id), projectId: nullable(id), folderId: nullable(id), turnId: nullable(id), ownerTurnId: nullable(id), stepId: nullable(id),
  family: OperationFamilySchema, actor: OperationActorSchema,
  name: nullable(Type.String({ pattern: "^[a-zA-Z0-9_.:-]{1,160}$" })), serverId: nullable(Type.String({ pattern: "^[a-zA-Z0-9_.:-]{1,160}$" })),
  env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox"), Type.Literal("unknown")]),
  modelId: nullable(id), providerId: nullable(id), role: nullable(ModelRoleSchema),
  started: Type.Boolean(), requestedAt: nullable(Type.String({ maxLength: 40 })), startedAt: nullable(Type.String({ maxLength: 40 })), finishedAt: nullable(Type.String({ maxLength: 40 })),
  elapsedMs: nullable(integer), outcome: OperationOutcomeSchema, imported: Type.Boolean(), approvalId: nullable(id),
  firstEventId: id, sourceEventId: id, sourceSeq: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  timeBasis: Type.Union([Type.Literal("request"), Type.Literal("tool-start"), Type.Literal("completion-only"), Type.Literal("unknown")]),
  diagnostic: nullable(Type.Union([Type.Literal("unknown-outcome"), Type.Literal("clock-regressed"), Type.Literal("inconsistent-result"), Type.Literal("duplicate-start"), Type.Literal("invalid-identifier"), Type.Literal("unlinked-source")])),
  repository: Type.Optional(nullable(RepositoryAttributionSchema)), repositoryDiagnostic: Type.Optional(nullable(RepositoryDiagnosticSchema)),
});
export type OperationEntry = Static<typeof OperationEntrySchema>;
export type OperationOutcome = Static<typeof OperationOutcomeSchema>;
export interface OperationCoverage { version: 1; since: string; sourceSeq: number; priorHistory: "retained-events-only" }
export interface OperationTotals {
  attempts: number; started: number; pending: number; running: number; completed: number; failed: number; denied: number; stopped: number; partial: number; unconfirmed: number; unknown: number;
  knownResults: number; failureRate: number | null; retries: null; observedWallMs: number; elapsedSamples: number; unmeasuredAttempts: number;
}
export interface ProfileStorage {
  profileId: string; measuredAt: string; measurement: "key-backed-retained-ciphertext"; integrity: "not-verified";
  bytes: { events: number; blobGrants: number; keys: number; total: number };
  counts: { events: number; blobGrants: number; blobContents: number; keys: number };
  physicalBytes: null; reclaimedPhysicalBytes: null;
}
export const TelemetryQuerySchema = Type.Union([
  object({ type: Type.Literal("telemetry.operations"), ...UsageFiltersSchema.properties, family: Type.Optional(OperationFamilySchema), actor: Type.Optional(OperationActorSchema),
    name: Type.Optional(Type.String({ maxLength: 160 })), serverId: Type.Optional(id), outcome: Type.Optional(OperationOutcomeSchema),
    offset: Type.Optional(integer), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
  object({ type: Type.Literal("telemetry.storage") }),
]);
export type TelemetryQuery = Static<typeof TelemetryQuerySchema>;
export const isTelemetryQuery = (value: unknown): value is TelemetryQuery => Value.Check(TelemetryQuerySchema, value);
export type TelemetryResponse =
  | { type: "telemetry.operations"; totals: OperationTotals; groups: Array<{ family: OperationEntry["family"]; name: string | null; serverId: string | null; actor: OperationEntry["actor"]; totals: OperationTotals }>;
      entries: OperationEntry[]; nextOffset: number | null; window: BudgetWindow; coverage: OperationCoverage | null; repositoryCoverage: RepositoryCoverage }
  | { type: "telemetry.storage"; storage: ProfileStorage };
