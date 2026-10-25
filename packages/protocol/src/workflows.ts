import { Type, type Static } from "typebox";
export const WorkflowKindSchema = Type.Union([Type.Literal("review"), Type.Literal("security"), Type.Literal("performance"), Type.Literal("debug")]);
export type WorkflowKind = Static<typeof WorkflowKindSchema>;
export const WorkflowCommandSchema = Type.Object({
  type: Type.Literal("workflow.start"), sessionId: Type.String({ minLength: 1, maxLength: 128 }), kind: WorkflowKindSchema,
  prompt: Type.String({ maxLength: 16384 }),
  consumeDraft: Type.Optional(Type.Object({ expectedRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })),
}, { additionalProperties: false });
const specific: Record<WorkflowKind, string> = {
  review: "Find high-confidence correctness bugs, regressions and missing behavior. Trace relevant callers and tests before editing; do not manufacture findings from style preferences.",
  security: "Find reachable exploitable weaknesses and fix their causes within policy. Validate actual trust boundaries; do not print secrets or attack unrelated real systems. Use generated regression fixtures.",
  performance: "Find measured bottlenecks and improve them without changing required outcomes. Compare meaningful before/after observations; distinguish wall time, CPU and memory, and never invent measurements.",
  debug: "Inspect the session-owned running app when present, including read_command_job live logs, read_agent_terminal and permitted project log files. Never read private User/Global consoles or infer process ownership from a PID/port. Use an explicitly configured DAP adapter and target through normal execution approvals; other targets need explicit selection. If no app is running, inspect code/logs and launch only through normal policy.",
};
export function workflowGuidance(kind: WorkflowKind): string {
  return `<moguri-workflow name="${kind}">
Investigate and fix within existing autonomy and policy. Unless the user narrows the request, inspect current changes (working tree, index and branch against the configured base), expanding relevant code as needed; inspect the attached project when clean. A project-free chat may use only its explicit prompt/admitted context, never an inherited root.
${specific[kind]}
Read applicable instructions, preserve unrelated work and verify meaningful fixes. This preset grants no permission and does not change model, Env, autonomy or budget, start another session, approve a question/tool, or bypass an existing compound/source/test review. Report unavailable authority or evidence honestly.
</moguri-workflow>`;
}
