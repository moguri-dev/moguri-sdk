import { Type, type Static } from "typebox";

export const LanguageToolSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 4096 }),
  line: Type.Integer({ minimum: 1, maximum: 1000000 }), column: Type.Integer({ minimum: 1, maximum: 1000000 }),
  scope: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  expectedDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  snapshotDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
}, { additionalProperties: false });
export type LanguageToolInput = Static<typeof LanguageToolSchema>;
export const LanguageSeedSchema = Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 4096 }), text: Type.String({ maxLength: 128 * 1024 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 200 }),
}, { additionalProperties: false });
export type LanguageSeed = Static<typeof LanguageSeedSchema>;
