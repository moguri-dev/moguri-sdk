import { Type, type Static } from "typebox";

export const LocalEndpointSchema = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,47}$" }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  enabled: Type.Boolean(),
  baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  auth: Type.Union([Type.Literal("none"), Type.Literal("bearer")]),
  models: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    contextWindow: Type.Integer({ minimum: 8192, maximum: 10_000_000 }),
    maxTokens: Type.Integer({ minimum: 64, maximum: 262144 }),
    imageInput: Type.Boolean(),
    toolInput: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });
export type LocalEndpoint = Static<typeof LocalEndpointSchema>;
export interface ProviderConnection {
  id: string; name: string; source: "copilot" | "local";
  status: "disconnected" | "connecting" | "connected" | "error";
  diagnostic: string | null;
}
