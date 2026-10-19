import { Type, type Static } from "typebox";

export const McpServerSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }), name: Type.String({ minLength: 1, maxLength: 120 }), enabled: Type.Boolean(),
  projectIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 100 })),
  transport: Type.Union([
    Type.Object({ type: Type.Literal("stdio"), command: Type.String({ minLength: 1, maxLength: 4096 }), args: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 64 }) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("http"), url: Type.String({ minLength: 1, maxLength: 2048 }), auth: Type.Union([Type.Literal("none"), Type.Literal("bearer")]) }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
export type McpServerConfig = Static<typeof McpServerSchema>;
export const SandboxSchema = Type.Object({
  executable: Type.String({ minLength: 1, maxLength: 4096 }),
  configPath: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  image: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  bundlePath: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  trustRootPath: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });
