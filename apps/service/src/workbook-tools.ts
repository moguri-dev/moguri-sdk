import { isUtf8 } from "node:buffer";
import type { Row } from "write-excel-file/node";
import { unzipSync, zipSync, strToU8, type Zippable } from "fflate";
import { MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { WriteDocumentSchema, type WriteDocumentInput, type EditDocumentInput } from "../../../packages/protocol/src/tooling.ts";
import { cellCoordinates } from "../../../packages/protocol/src/documents.ts";

type Sheets = NonNullable<WriteDocumentInput["sheets"]>;
const marker = "Moguri structured tooling v2";
const manifestPattern = /<!--Moguri structured tooling v2 ([A-Za-z0-9+/=]+)-->/g;
const encode = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
function validate(sheets: Sheets) {
  if (!sheets.length || new Set(sheets.map((sheet) => sheet.name.toLowerCase())).size !== sheets.length) throw new MoguriError("document_sheet", "Use at least one uniquely named sheet.");
  let total = 0;
  for (const sheet of sheets) {
    if (/[\\/*?:[\]]/.test(sheet.name) || !sheet.name.trim()) throw new MoguriError("document_sheet", "Use valid nonempty spreadsheet sheet names.");
    const cells = new Set<string>();
    for (const cell of sheet.cells) {
      if (++total > 10000 || !cellCoordinates(cell.address) || cells.has(cell.address)) throw new MoguriError("document_cells", "Use at most 10,000 unique valid A1 cells across sheets.");
      cells.add(cell.address);
      if (typeof cell.value === "number" && !Number.isFinite(cell.value)) throw new MoguriError("document_number", "Spreadsheet numbers must be finite.");
    }
  }
}
async function renderParts(sheets: Sheets): Promise<Record<string, Uint8Array>> {
  validate(sheets);
  const { default: writeExcelFile } = await import("write-excel-file/node");
  const inputs = sheets.map((sheet) => {
    const data: Row[] = [];
    for (const cell of sheet.cells) {
      const location = cellCoordinates(cell.address);
      if (!location) throw new MoguriError("document_cells", "The exact cell coordinate is invalid.");
      while (data.length < location.row) data.push([]);
      const row = data[location.row - 1]!;
      row[location.column - 1] = { value: cell.formula ? 0 : cell.value ?? undefined,
        ...(cell.bold ? { fontWeight: "bold" as const } : {}),
        ...(cell.numberFormat ? { format: cell.numberFormat } : {}) };
    }
    return { sheet: sheet.name, data };
  });
  const entries = unzipSync(await writeExcelFile(inputs, { fontFamily: "Arial", fontSize: 11 }).toBuffer());
  for (let index = 0; index < sheets.length; index++) {
    const path = `xl/worksheets/sheet${index + 1}.xml`, source = entries[path];
    if (!source) throw new MoguriError("document_writer", "The maintained writer returned no exact worksheet.");
    let text = Buffer.from(source).toString("utf8");
    for (const cell of sheets[index]!.cells.filter((cell) => cell.formula)) {
      let matches = 0;
      const pattern = new RegExp(`<c\\b([^>]*\\br="${cell.address}"[^>]*)>([\\s\\S]*?)<\\/c>`, "g");
      text = text.replace(pattern, (_whole, attributes: string) => {
        matches++;
        const type = typeof cell.value === "string" ? "str" : typeof cell.value === "boolean" ? "b" : "n";
        const cached = cell.value === null ? "" : `<v>${encode(typeof cell.value === "boolean" ? String(Number(cell.value)) : String(cell.value))}</v>`;
        return `<c${attributes.replace(/\s+t="[^"]*"/g, "")} t="${type}"><f>${encode(cell.formula!)}</f>${cached}</c>`;
      });
      if (matches !== 1) throw new MoguriError("document_writer", "An inert formula did not bind exactly one generated cell. No workbook was published.");
    }
    entries[path] = strToU8(text);
  }
  return entries;
}
export async function authorWorkbook(sheets: Sheets): Promise<Buffer> {
  const entries = await renderParts(sheets), manifest = Buffer.from(JSON.stringify(sheets)).toString("base64");
  if (manifest.length > 512 * 1024) throw new MoguriError("document_limit", "The complete structured workbook declaration exceeds 512 KiB.");
  const workbook = entries["xl/workbook.xml"];
  if (!workbook) throw new MoguriError("document_writer", "The maintained writer returned no original workbook.");
  const output: Zippable = { ...entries,
    "xl/workbook.xml": [strToU8(`${Buffer.from(workbook).toString("utf8")}<!--${marker} ${manifest}-->`), { level: 0 }] };
  return Buffer.from(zipSync(output));
}
export async function editWorkbook(input: EditDocumentInput, source: Buffer): Promise<Buffer> {
  if (!input.sheets?.length || input.replacements) throw new MoguriError("document_edit", "XLSX edits need explicit named-sheet cells.");
  validate(input.sheets);
  const entries = unzipSync(source), workbook = entries["xl/workbook.xml"];
  if (!workbook || !isUtf8(workbook)) throw new MoguriError("document_edit", "The original workbook source is unavailable.");
  const text = Buffer.from(workbook).toString("utf8"), manifests = [...text.matchAll(manifestPattern)];
  const encoded = manifests.length === 1 ? manifests[0]![1] : undefined;
  if (!encoded || encoded.length > 512 * 1024) throw new MoguriError("document_edit", "Edit only supported Moguri-generated simple workbooks. Unknown structures were not flattened.");
  const declared = Buffer.from(encoded, "base64");
  if (!isUtf8(declared) || declared.toString("base64") !== encoded) throw new MoguriError("document_edit", "The original structured workbook declaration is invalid.");
  const parsed = parse(WriteDocumentSchema, { path: "structured.xlsx", format: "xlsx", expectedDigest: "absent", sheets: JSON.parse(declared.toString("utf8")) });
  if (!parsed.sheets) throw new MoguriError("document_edit", "The original sheet declaration is missing.");
  const expected = await renderParts(parsed.sheets);
  entries["xl/workbook.xml"] = strToU8(text.replace(manifestPattern, ""));
  if (Object.keys(entries).length !== Object.keys(expected).length || Object.entries(expected).some(([path, bytes]) => !entries[path] || !Buffer.from(bytes).equals(entries[path]!))) {
    throw new MoguriError("document_edit", "Actual workbook bytes do not match the complete supported declaration. External edits/parts/styles remain untouched; no reconstruction or silent data loss was published.");
  }
  for (const changes of input.sheets) {
    const sheet: Sheets[number] | undefined = parsed.sheets.find((sheet) => sheet.name === changes.name);
    if (!sheet) throw new MoguriError("document_sheet", "Select an existing exact sheet. No replacement sheet was inferred.");
    for (const value of changes.cells) {
      const at = sheet.cells.findIndex((cell) => cell.address === value.address);
      const previous = at >= 0 ? sheet.cells[at]! : undefined;
      const next = {
        ...(previous?.bold !== undefined ? { bold: previous.bold } : {}), ...(previous?.numberFormat !== undefined ? { numberFormat: previous.numberFormat } : {}), ...value };
      if (at >= 0) sheet.cells[at] = next; else sheet.cells.push(next);
    }
  }
  return authorWorkbook(parsed.sheets);
}
