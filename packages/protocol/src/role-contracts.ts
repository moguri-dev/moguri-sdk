import { Type, type Static, type TSchema } from "typebox";
import type { CandidatePatch } from "./candidates.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const text = Type.String({ minLength: 1, maxLength: 1200 });
const router = { kind: Type.Literal("router"), draftId: id, minimumConfidence: Type.Number({ minimum: 0, maximum: 1 }) };
export const RoleContractSchema = Type.Union([
  object({ ...router, pattern: Type.Literal("cascade"), escalationId: id }),
  object({ ...router, pattern: Type.Literal("critique"), criticId: id }),
  object({ kind: Type.Literal("patch") }),
  object({ kind: Type.Literal("critic"), candidateIndex: Type.Integer({ minimum: 0, maximum: 31 }) }),
]);
export type RoleContract = Static<typeof RoleContractSchema>;
const plan = { draftId: id, confidence: Type.Number({ minimum: 0, maximum: 1 }), reason: text };
export const RoleRouterPlanSchema = Type.Union([
  object({ ...plan, pattern: Type.Literal("cascade"), escalationId: id }),
  object({ ...plan, pattern: Type.Literal("critique"), criticId: id }),
]);
export type RoleRouterPlan = Static<typeof RoleRouterPlanSchema>;
export const RoleCritiqueSchema = object({
  verdict: Type.Union([Type.Literal("pass"), Type.Literal("revise"), Type.Literal("reject")]),
  reason: text, issues: Type.Array(text, { maxItems: 8 }),
});
export type RoleCritique = Static<typeof RoleCritiqueSchema>;
export const RoleContractQuerySchema = object({
  type: Type.Literal("role.contract.read"), sequenceId: id, index: Type.Integer({ minimum: 0, maximum: 31 }),
});
export type RoleContractQuery = Static<typeof RoleContractQuerySchema>;
export interface RoleContractRead {
  type: "role.contract.read"; sequenceId: string; index: number; inputVersion: 1 | 2;
  contract: RoleContract | null; contextRoleIndices: number[];
  result: {
    status: "uncontracted" | "pending" | "invalid" | "rejected" | "valid";
    resultDigest: string | null; value: RoleRouterPlan | RoleCritique | CandidatePatch | null; diagnostic: string | null;
  };
  warning: string;
}
