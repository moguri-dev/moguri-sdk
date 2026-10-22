import { DOCUMENT_LIMITS as L, cellCoordinates, type DocumentData, type DocumentReadOptions, type DocumentSearchOptions, type DocumentPage, type DocumentSearch, type DocumentUnit } from "../../../packages/protocol/src/documents.ts";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import { textFilePage } from "./files.ts";

export function documentPage(document: DocumentData, options: DocumentReadOptions): DocumentPage {
  if (options.page !== undefined && document.format !== "pdf" || (options.sheet !== undefined || options.range !== undefined) && document.format !== "xlsx" ||
    options.range !== undefined && options.sheet === undefined || options.section !== undefined && (options.page !== undefined || options.sheet !== undefined)) throw new MoguriError("document_selection", "Choose a PDF page, a document section, or an exact XLSX sheet with optional A1 range, not mixed selectors.");
  if (options.page !== undefined && options.page > document.summary.pages || options.section !== undefined && !document.units.some((unit) => unit.location.section === options.section) ||
    options.sheet !== undefined && !document.summary.sheets.some((sheet) => sheet.name === options.sheet)) throw new MoguriError("document_selection", "The selected page, section or sheet does not exist in this exact retained document.");
  let bounds: { first: NonNullable<ReturnType<typeof cellCoordinates>>; last: NonNullable<ReturnType<typeof cellCoordinates>> } | undefined;
  if (options.range) {
    const [a, b = a] = options.range.split(":"), first = cellCoordinates(a!), last = cellCoordinates(b!);
    if (!first || !last || first.row > last.row || first.column > last.column) throw new MoguriError("document_range", "Choose an ascending A1 range within Excel's actual coordinate bounds.");
    bounds = { first, last };
  }
  const units = document.units.filter((unit) => (options.page === undefined || unit.location.page === options.page) &&
    (options.section === undefined || unit.location.section === options.section) && (options.sheet === undefined || unit.location.sheet === options.sheet) &&
    (!bounds || unit.location.row !== undefined && unit.location.column !== undefined && unit.location.row >= bounds.first.row && unit.location.row <= bounds.last.row &&
      unit.location.column >= bounds.first.column && unit.location.column <= bounds.last.column));
  const lines = units.map((unit) => JSON.stringify(unit) + "\n"), text = lines.join("");
  const page = textFilePage(text, { offset: options.offset, limit: options.limit });
  let byteOffset = 0, firstLocation: DocumentUnit["location"] | null = null, lastLocation: DocumentUnit["location"] | null = null;
  const end = page.offset + Buffer.byteLength(page.text);
  lines.forEach((line, index) => {
    const next = byteOffset + Buffer.byteLength(line);
    if (next > page.offset && byteOffset < end) { firstLocation ??= units[index]!.location; lastLocation = units[index]!.location; }
    byteOffset = next;
  });
  return { boundary: "scoped-controller-snapshot", untrusted: true, format: document.format, ...page, firstLocation, lastLocation };
}
export function documentSearch(document: DocumentData, options: DocumentSearchOptions): DocumentSearch {
  if (!options.query.isWellFormed() || options.sheet !== undefined && !document.summary.sheets.some((sheet) => sheet.name === options.sheet) ||
    (options.cursor ?? 0) > document.units.length) throw new MoguriError("document_search", "Choose a valid literal search, existing exact sheet and returned cursor.");
  const matches: DocumentSearch["matches"] = [], limit = options.limit ?? L.searchHits;
  let index = options.cursor ?? 0;
  for (; index < document.units.length; index++) {
    const unit = document.units[index]!;
    if (options.sheet !== undefined && unit.location.sheet !== options.sheet) continue;
    const text = unit.text + (unit.formula !== undefined && unit.formula !== null ? `\nFormula (inert): ${unit.formula}` : "");
    const page = textFilePage(text, { search: options.query, limit: 512 });
    if (page.matchOffset === null) continue;
    const match = { location: unit.location, text: page.text };
    if (matches.length >= limit || Buffer.byteLength(JSON.stringify([...matches, match])) > L.readBytes - 1024) break;
    matches.push(match);
  }
  return { boundary: "scoped-controller-snapshot", untrusted: true, matches, nextCursor: index < document.units.length ? index : null };
}
