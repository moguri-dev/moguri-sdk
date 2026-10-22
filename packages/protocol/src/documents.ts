import { Type, type Static } from "typebox";

export const DOCUMENT_LIMITS = {
  originalBytes: 8 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024, entryBytes: 8 * 1024 * 1024,
  entries: 256, compressionRatio: 200, pages: 200, sheets: 32, cells: 50_000, sections: 20_000,
  outputBytes: 2 * 1024 * 1024, unitBytes: 128 * 1024, xmlDepth: 64, xmlNodes: 200_000,
  timeoutMs: 10_000, heapMiB: 128, rssMiB: 384, concurrency: 2, readBytes: 16 * 1024, searchHits: 20,
} as const;
const integer = (maximum: number) => Type.Integer({ minimum: 0, maximum });
export const DocumentFormatSchema = Type.Union([Type.Literal("pdf"), Type.Literal("docx"), Type.Literal("xlsx")]);
export type DocumentFormat = Static<typeof DocumentFormatSchema>;
export const DocumentSummarySchema = Type.Object({
  version: Type.Literal(1), status: Type.Union([Type.Literal("ready"), Type.Literal("limited")]),
  extractor: Type.String({ minLength: 1, maxLength: 160 }),
  pages: integer(DOCUMENT_LIMITS.pages), sections: integer(DOCUMENT_LIMITS.cells), tables: integer(DOCUMENT_LIMITS.sections), cells: integer(DOCUMENT_LIMITS.cells),
  sheets: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 31 }), cells: integer(DOCUMENT_LIMITS.cells),
    state: Type.Union([Type.Literal("visible"), Type.Literal("hidden"), Type.Literal("veryHidden")]),
  }, { additionalProperties: false }), { maxItems: DOCUMENT_LIMITS.sheets }),
  noTextPages: Type.Array(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.pages }), { maxItems: DOCUMENT_LIMITS.pages }),
  limitations: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 16 }),
}, { additionalProperties: false });
export type DocumentSummary = Static<typeof DocumentSummarySchema>;
export const DocumentLocationSchema = Type.Object({
  section: Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.cells }),
  kind: Type.Union([Type.Literal("page"), Type.Literal("paragraph"), Type.Literal("heading"), Type.Literal("table-cell"), Type.Literal("cell")]),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.pages })),
  paragraph: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.sections })),
  level: Type.Optional(Type.Integer({ minimum: 1, maximum: 9 })),
  table: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.sections })),
  row: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_048_576 })),
  column: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384 })),
  columnSpan: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384 })),
  sheet: Type.Optional(Type.String({ minLength: 1, maxLength: 31 })),
  cell: Type.Optional(Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]{0,6}$" })),
}, { additionalProperties: false });
export type DocumentLocation = Static<typeof DocumentLocationSchema>;
export const DocumentUnitSchema = Type.Object({
  location: DocumentLocationSchema, text: Type.String({ maxLength: DOCUMENT_LIMITS.unitBytes }),
  formula: Type.Optional(Type.Union([Type.String({ maxLength: DOCUMENT_LIMITS.unitBytes }), Type.Null()])),
  formulaAttributes: Type.Optional(Type.Record(Type.String({ maxLength: 40 }), Type.String({ maxLength: 8192 }))),
  cachedValue: Type.Optional(Type.Union([Type.String({ maxLength: DOCUMENT_LIMITS.unitBytes }), Type.Null()])),
  valueType: Type.Optional(Type.String({ maxLength: 20 })),
}, { additionalProperties: false });
export type DocumentUnit = Static<typeof DocumentUnitSchema>;
export const DocumentDataSchema = Type.Object({
  version: Type.Literal(1), format: DocumentFormatSchema, summary: DocumentSummarySchema,
  units: Type.Array(DocumentUnitSchema, { maxItems: DOCUMENT_LIMITS.cells }),
}, { additionalProperties: false });
export type DocumentData = Static<typeof DocumentDataSchema>;
export const DocumentReadOptionsSchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.pages })),
  section: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.cells })),
  sheet: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  range: Type.Optional(Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$" })),
  offset: Type.Optional(integer(DOCUMENT_LIMITS.outputBytes)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.readBytes })),
}, { additionalProperties: false });
export type DocumentReadOptions = Static<typeof DocumentReadOptionsSchema>;
export const DocumentSearchOptionsSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }), sheet: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  cursor: Type.Optional(integer(DOCUMENT_LIMITS.cells)), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.searchHits })),
}, { additionalProperties: false });
export type DocumentSearchOptions = Static<typeof DocumentSearchOptionsSchema>;
export const DocumentListOptionsSchema = Type.Object({
  offset: Type.Optional(integer(DOCUMENT_LIMITS.cells)), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });
export type DocumentListOptions = Static<typeof DocumentListOptionsSchema>;
export interface DocumentPage {
  boundary: "scoped-controller-snapshot"; untrusted: true; format: DocumentFormat;
  text: string; bytes: number; offset: number; nextOffset: number | null; eof: boolean;
  firstLocation: DocumentLocation | null; lastLocation: DocumentLocation | null;
}
export interface DocumentSearch {
  boundary: "scoped-controller-snapshot"; untrusted: true;
  matches: { location: DocumentLocation; text: string }[]; nextCursor: number | null;
}
export function cellCoordinates(reference: string): { row: number; column: number } | null {
  const match = reference.match(/^([A-Z]{1,3})([1-9][0-9]{0,6})$/);
  if (!match) return null;
  const row = Number(match[2]), column = [...match[1]!].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
  return row <= 1_048_576 && column <= 16_384 ? { row, column } : null;
}
