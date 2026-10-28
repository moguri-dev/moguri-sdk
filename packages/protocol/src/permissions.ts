import { Type, type Static } from "typebox";

export function approvalProject(session: { projectId: string | null; repositories?: { projectId: string; name: string }[] }, repository: unknown): string | null {
  if (session.projectId) return session.projectId;
  const selected = session.repositories?.filter((binding) => binding.projectId === repository || binding.name === repository);
  return selected?.length === 1 ? selected[0]!.projectId : null;
}

const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const RememberApprovalSchema = Type.Object({
  scope: Type.Union([Type.Literal("session"), Type.Literal("project"), Type.Literal("global")]),
  match: Type.Union([Type.Literal("exact"), Type.Literal("family"), Type.Literal("tool")]),
}, { additionalProperties: false });
export type RememberApproval = Static<typeof RememberApprovalSchema>;
export const RememberedApprovalSchema = Type.Object({
  id,
  scope: Type.Union([
    Type.Object({ kind: Type.Literal("session"), sessionId: id }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("project"), projectId: id }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("global") }, { additionalProperties: false }),
  ]),
  env: Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]),
  target: Type.Union([
    Type.Object({ kind: Type.Literal("command"), command: Type.String({ minLength: 1, maxLength: 16384 }),
      match: Type.Union([Type.Literal("exact"), Type.Literal("family")]) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("mcp"), serverId: id, tool: Type.String({ minLength: 1, maxLength: 160 }),
      schemaDigest: hash, bindingDigest: hash }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("tool"), tool: Type.String({ minLength: 1, maxLength: 80 }),
      argumentsDigest: Type.Optional(hash) }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
export type RememberedApproval = Static<typeof RememberedApprovalSchema>;

export function commandFamily(command: string): string | null {
  if (/[\0\r\n;&|<>`$()\\]/.test(command)) return null;
  const executable = command.trim().match(/^([A-Za-z0-9][A-Za-z0-9._+-]*)(?:[ \t]|$)/)?.[1];
  if (!executable || /^(?:sh|bash|zsh|fish|dash|ksh|eval|exec|env|command|sudo|doas)$/.test(executable)) return null;
  return executable;
}
