import { isUtf8 } from "node:buffer";
import { crc32 } from "node:zlib";
import { posix, dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fromBufferPromise } from "yauzl";
import sax, { type SAXOptions } from "sax";
import { DOCUMENT_LIMITS as L, cellCoordinates, type DocumentData, type DocumentFormat, type DocumentLocation, type DocumentSummary, type DocumentUnit } from "../../../packages/protocol/src/documents.ts";

export class DocumentExtractionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new DocumentExtractionError(code, message); }
interface XmlNode { name: string; uri: string; attributes: Record<string, string>; text: string; children: XmlNode[] }
function xml(bytes: Buffer): XmlNode {
  if (!isUtf8(bytes) || bytes.includes(0)) fail("document_xml", "OOXML parts must contain valid UTF-8 XML without NUL.");
  const options: SAXOptions & { strictEntities: boolean } = { xmlns: true, position: false, strictEntities: true };
  const parser = sax.parser(true, options), stack: XmlNode[] = [];
  let root: XmlNode | undefined, nodes = 0;
  parser.ondoctype = () => fail("document_xml", "DTD/custom entities are unsupported. No external resource was read.");
  parser.onerror = () => fail("document_xml", "The document contains malformed XML. Nothing was attached.");
  parser.onprocessinginstruction = ({ name, body }) => {
    if (name !== "xml" || /encoding\s*=\s*["'](?!utf-?8|us-ascii)[^"']+/i.test(body)) fail("document_xml", "Unsupported XML processing instruction or encoding. No external resource was read.");
  };
  parser.onopentag = (tag) => {
    if (!("local" in tag) || ++nodes > L.xmlNodes || stack.length >= L.xmlDepth) fail("document_limit", "XML exceeds 64 levels or 200,000 elements in one part.");
    const attributes: Record<string, string> = Object.create(null);
    const entries = Object.values(tag.attributes);
    if (entries.length > 64) fail("document_limit", "An XML element exceeds 64 attributes.");
    for (const attribute of entries) {
      if (Buffer.byteLength(attribute.value) > 8192) fail("document_limit", "An XML attribute exceeds 8 KiB.");
      if (attribute.prefix !== "xmlns" && attribute.name !== "xmlns") attributes[attribute.local] = attribute.value;
    }
    const node: XmlNode = { name: tag.local, uri: tag.uri, attributes, text: "", children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else if (root) fail("document_xml", "An XML part has more than one root.");
    else root = node;
    stack.push(node);
  };
  parser.ontext = parser.oncdata = (text) => { if (stack.length) stack.at(-1)!.text += text; };
  parser.onclosetag = () => { stack.pop(); };
  parser.write(bytes.toString("utf8")).close();
  if (!root || stack.length) fail("document_xml", "An XML part is empty or incomplete.");
  return root;
}
const children = (node: XmlNode, name: string): XmlNode[] => node.children.filter((child) => child.name === name && child.uri === node.uri);
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => [...(child.name === name && child.uri === node.uri ? [child] : []), ...descendants(child, name)]);
}
const child = (node: XmlNode, name: string) => children(node, name)[0];
const namespaces = {
  word: ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
  sheet: ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"],
};
function required(parts: Map<string, Buffer>, path: string): XmlNode {
  const value = parts.get(path);
  if (!value) fail("document_structure", `The OOXML package is missing ${path}.`);
  return xml(value);
}
export async function archive(data: Buffer, format: "docx" | "xlsx"): Promise<Map<string, Buffer>> {
  if (data.readUInt32LE(0) !== 0x04034b50) fail("document_signature", "The selected Office document is not an unencrypted OOXML ZIP package.");
  const zip = await fromBufferPromise(data, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const parts = new Map<string, Buffer>(), names = new Set<string>();
  let expanded = 0;
  try {
    if (zip.entryCount > L.entries) fail("document_limit", "The archive exceeds 256 entries.");
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName, mode = entry.externalFileAttributes >>> 16 & 0o170000;
      if (name.length > 512 || /[\\\u0000-\u001f]/.test(name) || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === ".") || names.has(name.toLowerCase()) ||
        mode !== 0 && mode !== 0o100000 && mode !== 0o040000) fail("document_archive", "Archive paths must be unique ordinary entries, never links, devices or traversal paths.");
      names.add(name.toLowerCase());
      if (names.size > L.entries || entry.uncompressedSize > L.entryBytes || (expanded += entry.uncompressedSize) > L.expandedBytes ||
        entry.uncompressedSize > 65536 && entry.uncompressedSize > Math.max(1, entry.compressedSize) * L.compressionRatio) fail("document_limit", "Archive expansion exceeds its entry, 32 MiB total or 200:1 ratio bound.");
      if (entry.isEncrypted()) fail("document_encrypted", "Encrypted/password-protected Office packages are unsupported.");
      if (!entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) fail("document_archive", "Unsupported ZIP compression.");
      if (/(?:^|\/)(?:vbaProject|activeX|embeddings)(?:[./]|$)/i.test(name) || /\.(?:exe|dll|com|js|vbs)$/i.test(name)) fail("document_active_content", "Macros, embedded executable objects and active content are unsupported. Nothing was executed.");
      const stream = await zip.openReadStreamPromise(entry), buffers: Buffer[] = [];
      let size = 0, checksum = 0;
      for await (const value of stream) {
        const buffer = Buffer.from(value); size += buffer.length;
        if (size > entry.uncompressedSize || size > L.entryBytes) { stream.destroy(); fail("document_limit", "An archive entry expanded beyond its declared bounded size."); }
        checksum = crc32(buffer, checksum);
        if (/\.(?:xml|rels)$/i.test(name)) buffers.push(buffer);
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) fail("document_archive", "An archive entry failed its exact size/CRC check.");
      if (buffers.length) {
        const part = Buffer.concat(buffers);
        xml(part);
        parts.set(name, part);
      }
    }
  } finally { zip.close(); }
  const types = required(parts, "[Content_Types].xml");
  if (types.name !== "Types" || types.uri !== "http://schemas.openxmlformats.org/package/2006/content-types") fail("document_structure", "OOXML content types are invalid.");
  const main = format === "docx" ? "/word/document.xml" : "/xl/workbook.xml";
  const contentType = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  if (!children(types, "Override").some((node) => node.attributes.PartName === main && node.attributes.ContentType === contentType) ||
    types.children.some((node) => /macroEnabled|vbaProject|activeX|oleObject/i.test(node.attributes.ContentType ?? ""))) fail("document_structure", "Actual OOXML content types do not match the selected non-macro DOCX/XLSX format.");
  const relationships = required(parts, "_rels/.rels");
  if (relationships.name !== "Relationships" || relationships.uri !== "http://schemas.openxmlformats.org/package/2006/relationships" ||
    !children(relationships, "Relationship").some((node) => /\/officeDocument$/.test(node.attributes.Type ?? "") && node.attributes.Target?.replace(/^\//, "") === main.slice(1) && node.attributes.TargetMode !== "External")) fail("document_structure", "The package does not bind its expected internal Office document.");
  return parts;
}
function output(format: DocumentFormat, extractor: string) {
  const summary: DocumentSummary = { version: 1, status: "ready", extractor, pages: 0, sections: 0, tables: 0, cells: 0, sheets: [], noTextPages: [], limitations: [] };
  const document: DocumentData = { version: 1, format, summary, units: [] };
  let bytes = 0;
  return {
    document, summary,
    add(location: Omit<DocumentLocation, "section">, text: string, fields: Omit<DocumentUnit, "location" | "text"> = {}) {
      if (Buffer.byteLength(text) > L.unitBytes || Buffer.byteLength(fields.formula ?? "") > L.unitBytes || Buffer.byteLength(fields.cachedValue ?? "") > L.unitBytes) fail("document_limit", "An extracted text/formula unit exceeds 128 KiB.");
      const unit: DocumentUnit = { location: { ...location, section: document.units.length + 1 }, text, ...fields };
      bytes += Buffer.byteLength(JSON.stringify(unit)) + 1;
      if (bytes > L.outputBytes || document.units.length >= (format === "xlsx" ? L.cells : L.sections)) fail("document_limit", "Complete extracted content exceeds 2 MiB or its section/cell bound. No content was truncated.");
      document.units.push(unit); summary.sections = document.units.length;
    },
    finish() {
      if (Buffer.byteLength(JSON.stringify(document)) > L.outputBytes) fail("document_limit", "Complete extraction metadata/content exceeds 2 MiB. No content was truncated.");
      return document;
    },
  };
}
function paragraphText(node: XmlNode): string {
  if (node.name === "del" || node.name === "moveFrom") return "";
  if (node.name === "t") return node.text;
  if (node.name === "tab") return "\t";
  if (node.name === "br" || node.name === "cr") return "\n";
  return node.children.filter((entry) => entry.uri === node.uri).map(paragraphText).join("");
}
function word(parts: Map<string, Buffer>): DocumentData {
  const root = required(parts, "word/document.xml"), body = child(root, "body"), result = output("docx", "sax@1.6.1; yauzl@3.4.0; moguri-ooxml-v1");
  if (root.name !== "document" || !namespaces.word.includes(root.uri) || !body) fail("document_structure", "DOCX has no valid WordprocessingML body.");
  if (descendants(body, "altChunk").length || descendants(body, "object").length) fail("document_unsupported", "Alternate chunks and embedded objects are unsupported. No code or external conversion was run.");
  const styles = new Map<string, XmlNode>();
  if (parts.has("word/styles.xml")) {
    const root = required(parts, "word/styles.xml");
    if (root.name !== "styles" || !namespaces.word.includes(root.uri)) fail("document_structure", "DOCX styles have an invalid WordprocessingML namespace.");
    for (const style of children(root, "style")) if (style.attributes.styleId) styles.set(style.attributes.styleId, style);
  }
  const level = (properties: XmlNode | undefined, seen = new Set<string>()): number | undefined => {
    if (!properties) return;
    const outline = child(properties, "outlineLvl")?.attributes.val;
    if (outline !== undefined) return /^[0-8]$/.test(outline) ? Number(outline) + 1 : undefined;
    const id = child(properties, "pStyle")?.attributes.val ?? child(properties, "basedOn")?.attributes.val;
    if (!id) return;
    const standard = id.match(/^Heading([1-9])$/i);
    if (standard) return Number(standard[1]);
    if (seen.has(id) || seen.size >= L.xmlDepth) fail("document_structure", "DOCX style inheritance is cyclic or too deep.");
    seen.add(id);
    const style = styles.get(id);
    if (style) return level(child(style, "pPr"), seen) ?? level(style, seen);
  };
  let paragraph = 0, table = 0;
  const walk = (node: XmlNode) => {
    for (const entry of node.children.filter((entry) => entry.uri === root.uri)) {
      if (entry.name === "p") {
        const heading = level(child(entry, "pPr"));
        result.add({ kind: heading ? "heading" : "paragraph", paragraph: ++paragraph, ...(heading ? { level: heading } : {}) }, paragraphText(entry));
      } else if (entry.name === "tbl") {
        if (descendants(entry, "tbl").length) fail("document_unsupported", "Nested DOCX tables are unsupported; the complete draft was preserved.");
        table++; result.summary.tables = table;
        let row = 0;
        for (const tr of children(entry, "tr")) {
          row++; let column = 1;
          for (const tc of children(tr, "tc")) {
            const spanText = child(child(tc, "tcPr") ?? tc, "gridSpan")?.attributes.val ?? "1", span = Number(spanText);
            if (!Number.isSafeInteger(span) || span < 1 || column + span > 16385) fail("document_structure", "DOCX table columns are invalid.");
            result.add({ kind: "table-cell", table, row, column, columnSpan: span }, descendants(tc, "p").map(paragraphText).join("\n"));
            result.summary.cells++; column += span;
          }
        }
      } else if (!["del", "moveFrom", "sectPr"].includes(entry.name)) walk(entry);
    }
  };
  walk(body);
  result.summary.limitations.push("Body text only. Formatting, media, headers/footers, comments, deleted revisions and field evaluation are not extracted. External links are never fetched.");
  if (descendants(body, "drawing").length || descendants(body, "instrText").length) result.summary.status = "limited";
  return result.finish();
}
function spreadsheetText(node: XmlNode): string {
  if (node.name === "rPh") return "";
  return node.name === "t" ? node.text : node.children.filter((child) => child.uri === node.uri).map(spreadsheetText).join("");
}
function spreadsheet(parts: Map<string, Buffer>): DocumentData {
  const root = required(parts, "xl/workbook.xml"), result = output("xlsx", "sax@1.6.1; yauzl@3.4.0; moguri-ooxml-v1");
  if (root.name !== "workbook" || !namespaces.sheet.includes(root.uri)) fail("document_structure", "XLSX has no valid SpreadsheetML workbook.");
  const relations = required(parts, "xl/_rels/workbook.xml.rels");
  if (relations.name !== "Relationships" || relations.uri !== "http://schemas.openxmlformats.org/package/2006/relationships") fail("document_structure", "Workbook relationships are malformed.");
  let shared: string[] = [];
  if (parts.has("xl/sharedStrings.xml")) {
    const root = required(parts, "xl/sharedStrings.xml");
    if (root.name !== "sst" || !namespaces.sheet.includes(root.uri)) fail("document_structure", "XLSX shared strings have an invalid SpreadsheetML namespace.");
    shared = children(root, "si").map(spreadsheetText);
  }
  const sheets = children(child(root, "sheets") ?? root, "sheet");
  if (!sheets.length || sheets.length > L.sheets) fail("document_limit", "Use an XLSX workbook with 1..32 sheets.");
  const names = new Set<string>();
  for (const sheet of sheets) {
    const name = sheet.attributes.name ?? "", state = sheet.attributes.state ?? "visible";
    if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name) || names.has(name.toLowerCase()) || !["visible", "hidden", "veryHidden"].includes(state)) fail("document_structure", "Sheet names/visibility are invalid or duplicated; Excel sheet names are limited to 31 characters.");
    names.add(name.toLowerCase());
    const relation = children(relations, "Relationship").find((node) => node.attributes.Id === sheet.attributes.id);
    if (!relation || relation.attributes.TargetMode === "External" || !/\/worksheet$/.test(relation.attributes.Type ?? "")) fail("document_unsupported", "Only internal worksheets are supported. External/chart sheets were not fetched or silently omitted.");
    const target = relation.attributes.Target ?? "";
    if (/^[a-z]+:/i.test(target) || target.includes("\\") || target.split("/").includes("..")) fail("document_structure", "Worksheet relationship target is not an internal package part.");
    const path = target.startsWith("/") ? target.slice(1) : posix.join("xl", target), worksheet = required(parts, path);
    if (worksheet.name !== "worksheet" || !namespaces.sheet.includes(worksheet.uri)) fail("document_structure", "A sheet contains invalid SpreadsheetML.");
    const rows = children(child(worksheet, "sheetData") ?? worksheet, "row");
    if (result.summary.cells + rows.reduce((total, row) => total + children(row, "c").length, 0) > L.cells) fail("document_limit", "The workbook exceeds 50,000 actual cells. No declared dimensions were allocated or content truncated.");
    let count = 0;
    const seen = new Set<string>();
    for (const row of rows) {
      for (const cell of children(row, "c")) {
        const reference = cell.attributes.r ?? "", coordinates = cellCoordinates(reference);
        if (!coordinates || seen.has(reference) || row.attributes.r !== undefined && String(coordinates.row) !== row.attributes.r) fail("document_structure", "Cell coordinates are invalid, duplicated or inconsistent with their row.");
        seen.add(reference);
        const type = cell.attributes.t ?? "n", value = child(cell, "v"), formula = child(cell, "f");
        let cachedValue: string | null = value?.text ?? null;
        if (type === "s") {
          const index = Number(cachedValue);
          if (cachedValue === null || !/^\d+$/.test(cachedValue) || !Number.isSafeInteger(index) || shared[index] === undefined) fail("document_structure", "A cell references an unavailable shared string.");
          cachedValue = shared[index]!;
        } else if (type === "inlineStr") cachedValue = spreadsheetText(cell);
        else if (!["n", "b", "str", "e", "d"].includes(type)) fail("document_unsupported", "An XLSX cell uses an unsupported cached value type.");
        result.add({ kind: "cell", sheet: name, cell: reference, ...coordinates }, cachedValue ?? "", {
          cachedValue, valueType: type, formula: formula ? formula.text : null, ...(formula ? { formulaAttributes: formula.attributes } : {}),
        });
        result.summary.cells++;
        count++;
      }
    }
    result.summary.sheets.push({ name, cells: count, state: state === "hidden" || state === "veryHidden" ? state : "visible" });
  }
  result.summary.limitations.push("Raw cached values and inert formulas only; never recalculated. Missing caches are null. Shared/array formula attributes are retained, not expanded. Formatting, charts and media are not rendered; external links are never fetched.");
  return result.finish();
}
async function pdf(data: Buffer): Promise<DocumentData> {
  if (!data.subarray(0, 8).toString("ascii").match(/^%PDF-[12]\.\d/) || !data.subarray(-1024).includes(Buffer.from("%%EOF"))) fail("document_signature", "Choose a complete PDF with a valid header and EOF marker.");
  if (/\/Encrypt(?:\s|\/|<|\[|\d)/.test(data.toString("latin1"))) fail("document_encrypted", "Encrypted/password-protected PDFs are unsupported, including empty-password encryption.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  let unavailableResource = false;
  class LocalPdfData {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      if (!["cMapUrl", "standardFontDataUrl"].includes(kind) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/.test(filename)) { unavailableResource = true; throw new Error("Unsupported PDF resource; external loading is disabled."); }
      try { return new Uint8Array(await readFile(join(packageRoot, kind === "cMapUrl" ? "cmaps" : "standard_fonts", filename))); }
      catch (error) { unavailableResource = true; throw error; }
    }
  }
  const loading = getDocument({ data: new Uint8Array(data), stopAtErrors: true, useSystemFonts: false, disableFontFace: true, fontExtraProperties: false,
    useWorkerFetch: false, useWasm: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, maxImageSize: 0, enableXfa: false,
    disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0, BinaryDataFactory: LocalPdfData });
  try {
    const document = await loading.promise, result = output("pdf", "pdfjs-dist@6.4.299; moguri-pdf-text-v1");
    if (await document.getPermissions() !== null) fail("document_encrypted", "Encrypted PDFs are unsupported.");
    if (document.isPureXfa) fail("document_unsupported", "XFA-only PDFs are unsupported; no form or embedded code was executed.");
    if (document.numPages > L.pages) fail("document_limit", "PDFs are limited to 200 pages.");
    result.summary.pages = document.numPages;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), chunks: string[] = [];
      let bytes = 0;
      const reader = page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader();
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          for (const item of part.value.items) if ("str" in item) {
            const text = item.str + (item.hasEOL ? "\n" : " ");
            bytes += Buffer.byteLength(text);
            if (bytes > L.unitBytes) fail("document_limit", "A PDF page's extracted text exceeds 128 KiB.");
            chunks.push(text);
          }
        }
      } finally { await reader.cancel(); reader.releaseLock(); page.cleanup(); }
      const text = chunks.join("").trimEnd();
      result.add({ kind: "page", page: number }, text);
      if (!text.trim()) result.summary.noTextPages.push(number);
    }
    if (unavailableResource) fail("document_resource", "Required bundled PDF character/font data was unavailable. Incomplete extraction was not retained.");
    result.summary.limitations.push("Text extraction preserves page numbers, not guaranteed visual reading order. OCR, raster content, annotations, embedded files and form/script execution are unavailable.");
    if (result.summary.noTextPages.length) {
      result.summary.status = "limited";
      result.summary.limitations.push("Listed no-text pages are blank or possibly scanned/image-only. OCR is unavailable; these pages remain represented.");
    }
    return result.finish();
  } finally { await loading.destroy(); }
}
export async function extractDocument(data: Buffer, format: DocumentFormat): Promise<DocumentData> {
  if (!data.length || data.length > L.originalBytes) fail("document_limit", "Document originals must be nonempty and at most 8 MiB.");
  if (data.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) fail("document_encrypted", "Encrypted Office containers and legacy binary Office formats are unsupported.");
  if (format === "pdf") return pdf(data);
  if (data.length < 4) fail("document_signature", "The selected Office document is incomplete.");
  const parts = await archive(data, format);
  return format === "docx" ? word(parts) : spreadsheet(parts);
}
