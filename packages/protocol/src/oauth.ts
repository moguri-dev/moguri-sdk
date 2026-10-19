import { Type, type Static } from "typebox";
const id = Type.String({ minLength: 1, maxLength: 128 });
const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export interface McpAuthorization {
  id: string; serverId: string; projectId: string | null; sessionId: string | null;
  state: "waiting" | "exchanging" | "connected" | "cancelled" | "failed" | "expired" | "cleared";
  expiresAt: number | null; diagnostic: string | null;
  authorizationUrlReady?: boolean;
}
export const OAuthCommandSchema = Type.Union([
  object({ type: Type.Literal("mcp.oauth.begin"), serverId: id, sessionId: Type.Optional(id) }),
  object({ type: Type.Literal("mcp.oauth.cancel"), authorizationId: id }),
  object({ type: Type.Literal("mcp.oauth.clear"), serverId: id, sessionId: Type.Optional(id) }),
  object({ type: Type.Literal("mcp.oauth.client"), serverId: id, sessionId: Type.Optional(id), clientId: Type.String({ minLength: 1, maxLength: 4096 }), clientSecret: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })), issuer: Type.String({ minLength: 1, maxLength: 2048 }), redirectUri: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })) }),
]);
export type OAuthCommand = Static<typeof OAuthCommandSchema>;
export const OAuthQuerySchema = object({ type: Type.Literal("mcp.oauth.status"), authorizationId: id });
export type OAuthQuery = Static<typeof OAuthQuerySchema>;
export type OAuthResponse = { type: "mcp.oauth.status"; authorization: McpAuthorization; url: string | null };
