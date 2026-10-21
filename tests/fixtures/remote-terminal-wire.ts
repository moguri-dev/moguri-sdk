import { Type, type Static } from "typebox";
import { TerminalOwnerSchema } from "../../packages/protocol/src/terminals.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
const common = { format: Type.Literal("moguri-private-remote-console"), version: Type.Literal(1) };
export const RemoteConsoleInitSchema = Type.Union([
  Type.Object({ ...common, action: Type.Literal("prepare"), profileId: id, sessionId: id, projectId: id,
    root: Type.String({ minLength: 1, maxLength: 4096 }), ownerId: id }, { additionalProperties: false }),
  Type.Object({ ...common, action: Type.Union([Type.Literal("start"), Type.Literal("attach")]),
    owner: TerminalOwnerSchema, key: Type.String({ minLength: 44, maxLength: 44 }), clientId: id }, { additionalProperties: false }),
  Type.Object({ ...common, action: Type.Literal("cleanup"), owner: TerminalOwnerSchema }, { additionalProperties: false }),
]);
export type RemoteConsoleInit = Static<typeof RemoteConsoleInitSchema>;
