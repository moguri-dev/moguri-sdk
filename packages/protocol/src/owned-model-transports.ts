import { Type, type Static } from "typebox";

const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const root = Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]);
export const OwnedModelTransportSchema = Type.Union([
  Type.Object({ env: Type.Literal("Remote"), executionId: id, workerDigest: hash, peerFingerprint: Type.String({ pattern: "^SHA256:[A-Za-z0-9+/]{43}$" }),
    hostKey: Type.String({ minLength: 1, maxLength: 16384 }), root }, { additionalProperties: false }),
  Type.Object({ env: Type.Literal("Sandbox"), executionId: id, workerDigest: hash, workspaceId: id, nativeSessionId: id,
    planDigest: hash, signerFingerprint: hash, sourceDigest: hash, image: Type.String({ minLength: 1, maxLength: 4096 }), root },
  { additionalProperties: false }),
]);
export type OwnedModelTransport = Static<typeof OwnedModelTransportSchema>;
