import { Value } from "typebox/value";
import {
  MoguriError, parse,
} from "../../../packages/protocol/src/index.ts";
import {
  RoleContractSchema, RoleCritiqueSchema, RoleRouterPlanSchema,
  type RoleContract, type RoleCritique, type RoleRouterPlan,
} from "../../../packages/protocol/src/role-contracts.ts";

export const ROLE_CONTRACT_WARNING = "Contract validity checks only the original declared shape, scope and known accounting. Model advice is not code quality, independent-family proof, permission, user acceptance or public compound readiness.";
export interface ContractedRoleDefinition {
  role: string; modelId: string; contextRoleIndices?: number[]; contract?: RoleContract;
}
export function validateRoleDefinitions(roles: ContractedRoleDefinition[], version: 1 | 2): void {
  for (const [index, role] of roles.entries()) {
    const selected = role.contextRoleIndices;
    if (version === 1 && (selected !== undefined || role.contract !== undefined)) throw new MoguriError("role_contract_version", "Version-1 input cannot acquire new role contracts or context semantics. Preserve the original bytes.", 409);
    if (selected !== undefined && (selected.some((value, position) => !Number.isInteger(value) || value < 0 || value >= index || position > 0 && value <= selected[position - 1]!) ||
      new Set(selected).size !== selected.length)) throw new MoguriError("role_contract_context", "Select unique earlier role indices in their original order. No forward reference, duplicate or silent sorting was adopted.", 409);
    const contract = role.contract;
    if (!contract) continue;
    parse(RoleContractSchema, contract);
    if (!selected || selected.some((earlier) => roles[earlier]?.role === "router")) throw new MoguriError("role_contract_context", "Contracted roles require explicit prior-result selection and may not receive router explanations, even as quoted data.", 409);
    if (contract.kind === "router") {
      const other = contract.pattern === "cascade" ? { role: "escalation", id: contract.escalationId } : { role: "critic", id: contract.criticId };
      if (role.role !== "router" || selected.length || !roles.slice(index + 1).some((later) => later.role === "draft" && later.modelId === contract.draftId) ||
        !roles.slice(index + 1).some((later) => later.role === other.role && later.modelId === other.id)) throw new MoguriError("role_contract_binding", "The router contract must name this exact later draft and critic/escalation, with no inherited result context.", 409);
    } else if (contract.kind === "patch") {
      if (!["draft", "revision", "escalation"].includes(role.role)) throw new MoguriError("role_contract_binding", "Only an actual proposer role may own the canonical patch contract.", 409);
    } else if (role.role !== "critic" || selected.length !== 1 || selected[0] !== contract.candidateIndex ||
      roles[contract.candidateIndex]?.contract?.kind !== "patch") {
      throw new MoguriError("role_contract_binding", "A critic contract must receive only its exact earlier canonical patch role, never another candidate or hidden conversation.", 409);
    }
  }
}
export function roleContractPrompt(contract: RoleContract): string {
  const shape = contract.kind === "router" ? "Return only pattern, draftId, criticId or escalationId as configured, confidence and reason." :
    contract.kind === "critic" ? "Return only verdict (pass, revise or reject), reason and issues. Your opinion cannot approve code or permissions." :
      "Return only canonical patch JSON with kind, summary and edits using the exact selected original paths/bases. Do not execute or accept it.";
  return `${shape}\nOriginal output contract: ${JSON.stringify(contract)}\n${ROLE_CONTRACT_WARNING}`;
}
const bounded = (text: string) => Boolean(text.trim()) && text.isWellFormed() && Buffer.byteLength(text) <= 1200 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
export function validateRoleAdvice(contract: Exclude<RoleContract, { kind: "patch" }>, text: string):
  { status: "valid" | "rejected"; value: RoleRouterPlan | RoleCritique; diagnostic: string | null } {
  parse(RoleContractSchema, contract);
  if (!text.isWellFormed() || !text.trim() || Buffer.byteLength(text) > 32 * 1024) throw new MoguriError("role_contract_text", "Role advice is empty or exceeds its exact lossless 32-KiB contract. No repair, truncation or continuation.", 409);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw new MoguriError("role_contract_json", "Role advice is not one exact JSON object. No Markdown repair or next role was authorized.", 409); throw error; }
  if (contract.kind === "router") {
    if (!Value.Check(RoleRouterPlanSchema, value) || !bounded(value.reason) || value.pattern !== contract.pattern ||
      value.draftId !== contract.draftId || value.confidence < contract.minimumConfidence ||
      value.pattern === "cascade" && (contract.pattern !== "cascade" || value.escalationId !== contract.escalationId) ||
      value.pattern === "critique" && (contract.pattern !== "critique" || value.criticId !== contract.criticId)) {
      throw new MoguriError("role_contract_plan", "Router data does not match the exact declared pattern/models/confidence. No endpoint, fallback or approval was inferred.", 409);
    }
    return { status: "valid", value: structuredClone(value), diagnostic: null };
  }
  if (!Value.Check(RoleCritiqueSchema, value) || !bounded(value.reason) || value.issues.some((issue) => !bounded(issue))) {
    throw new MoguriError("role_contract_critic", "Critic data does not match its bounded verdict/reason/issues contract. No next role, quality or approval was inferred.", 409);
  }
  return { status: value.verdict === "reject" ? "rejected" : "valid", value: structuredClone(value),
    diagnostic: value.verdict === "reject" ? "The bound critic rejected this unaccepted proposal. Its opinion is retained; no continuation or user approval was authorized." : null };
}
