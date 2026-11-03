import { Type, type Static } from "typebox";

const selector = Type.String({ minLength: 1, maxLength: 512 });
export const PlaywrightToolSchema = Type.Object({
  launch: Type.Union([
    Type.Object({ kind: Type.Literal("electron"), executable: Type.String({ minLength: 1, maxLength: 4096 }),
      entry: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("chromium"), executable: Type.String({ minLength: 1, maxLength: 4096 }),
      url: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  ]),
  actions: Type.Array(Type.Union([
    Type.Object({ action: Type.Literal("click"), selector }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("type"), selector, text: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("wait"), selector: Type.Optional(selector), milliseconds: Type.Integer({ minimum: 0, maximum: 10000 }) }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("snapshot") }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("take_screenshot"), name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false }),
  ]), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
export type PlaywrightToolInput = Static<typeof PlaywrightToolSchema>;
