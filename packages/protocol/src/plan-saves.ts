import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const nullableText = Type.Union([Type.String({ maxLength: 128 * 1024 }), Type.Null()]);
export const PlanFileResultSchema = Type.Object({
  path, outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("stopped"), Type.Literal("partial")]),
  fileOutcome: Type.Union([Type.Literal("not-started"), Type.Literal("written"), Type.Literal("unconfirmed")]),
  createdDirectories: Type.Array(path, { maxItems: 256 }),
  text: nullableText, digest: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
  bytes: Type.Union([Type.Integer({ minimum: 0, maximum: 128 * 1024 }), Type.Null()]),
  readback: Type.Boolean(), diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });
export type PlanFileResult = Static<typeof PlanFileResultSchema>;
export interface PlanBinding { bindingDigest: string; boundary: { env: "Remote"; root: string; hostFingerprint: string; workerDigest: string } }
export interface RemotePlanSave {
  id: string; sessionId: string; projectId: string; commandId: string; commandDigest: string; revision: number;
  executionId: string | null; root: string; hostFingerprint: string; workerDigest: string;
  path: string; expectedDigest: string; textDigest: string; inputDigest: string; policyDigest: string;
  status: "running" | "completed" | "failed" | "stopped" | "partial";
  phase: "intent" | "authorized" | "result" | "terminal" | "settled";
  fileOutcome: PlanFileResult["fileOutcome"]; createdDirectories: string[]; resultDigest: string | null;
  workerOutcome: PlanFileResult["outcome"] | null; artifactId: string | null; diagnostic: string | null;
  createdAt: string; updatedAt: string;
}
export const PlanSaveCommandSchema = Type.Object({
  type: Type.Literal("plan.stop-save"), sessionId: id, saveId: id,
}, { additionalProperties: false });
export type PlanSaveCommand = Static<typeof PlanSaveCommandSchema>;
export const isPlanSaveCommand = (value: unknown): value is PlanSaveCommand => Value.Check(PlanSaveCommandSchema, value);
export const PlanSaveQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("plan.saves"), sessionId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("plan.save-info"), sessionId: id, saveId: id }, { additionalProperties: false }),
]);
export type PlanSaveQuery = Static<typeof PlanSaveQuerySchema>;
export const isPlanSaveQuery = (value: unknown): value is PlanSaveQuery => Value.Check(PlanSaveQuerySchema, value);
export type PlanSaveResponse =
  | { type: "plan.saves"; saves: RemotePlanSave[] }
  | { type: "plan.save-info"; save: RemotePlanSave; result: PlanFileResult | null };
