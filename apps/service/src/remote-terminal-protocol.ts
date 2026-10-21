import { Type, type Static } from "typebox";
import { PreparedRemoteTerminalOwnerSchema, RemoteTerminalOwnerSchema } from "../../../packages/protocol/src/terminals.ts";

const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const common = { format: Type.Literal("moguri-remote-user-console"), version: Type.Literal(1) };
export const RemoteTerminalInitSchema = Type.Union([
  Type.Object({ ...common, action: Type.Literal("binding"), profileId: id, sessionId: id, projectId: id, workspaceId: Type.Null(),
    root: Type.String({ minLength: 1, maxLength: 4096 }), peerDigest: hash, bridgeDigest: hash, brokerDigest: hash }, { additionalProperties: false }),
  Type.Object({ ...common, action: Type.Literal("prepare"), owner: RemoteTerminalOwnerSchema }, { additionalProperties: false }),
  Type.Object({ ...common, action: Type.Literal("cleanup"), owner: RemoteTerminalOwnerSchema }, { additionalProperties: false }),
  Type.Object({ ...common, action: Type.Union([Type.Literal("start"), Type.Literal("attach")]), owner: PreparedRemoteTerminalOwnerSchema,
    key: Type.String({ minLength: 44, maxLength: 44 }), clientId: id }, { additionalProperties: false }),
]);
export type RemoteTerminalInit = Static<typeof RemoteTerminalInitSchema>;
