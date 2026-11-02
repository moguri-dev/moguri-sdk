import { Type, type Static } from "typebox";

export const ToolDeliverySchema = Type.Union([
  Type.Object({ kind: Type.Literal("image"), name: Type.String({ minLength: 1, maxLength: 100 }),
    data: Type.String({ minLength: 1, maxLength: Math.ceil(8 * 1024 * 1024 / 3) * 4 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("html"), title: Type.String({ minLength: 1, maxLength: 100 }),
    html: Type.String({ minLength: 1, maxLength: 128 * 1024 }) }, { additionalProperties: false }),
]);
export const ToolDeliveriesSchema = Type.Array(ToolDeliverySchema, { maxItems: 4 });
export type ToolDelivery = Static<typeof ToolDeliverySchema>;
export const RenderHtmlSchema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 100 }),
  html: Type.String({ minLength: 1, maxLength: 128 * 1024 }) }, { additionalProperties: false });
export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const isolatedHtmlDocument = (html: string) => `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta charset="utf-8">${html}`;
const owner = { sessionId: Type.String({ minLength: 1, maxLength: 128 }), attachmentId: Type.String({ minLength: 1, maxLength: 128 }),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }) };
export const HtmlPreviewInputSchema = Type.Union([
  Type.Object({ type: Type.Literal("show"), ...owner, bounds: Type.Object({
    x: Type.Number({ minimum: -8192, maximum: 8192 }), y: Type.Number({ minimum: -8192, maximum: 8192 }),
    width: Type.Number({ minimum: 1, maximum: 8192 }), height: Type.Number({ minimum: 1, maximum: 8192 }),
  }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("hide"), ...owner }, { additionalProperties: false }),
]);
export type HtmlPreviewInput = Static<typeof HtmlPreviewInputSchema>;
