import { DatabaseSync, constants, type SQLInputValue, type StatementSync } from "node:sqlite";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse, MoguriError } from "../../../packages/protocol/src/core.ts";
import { SqliteQuerySchema, SqliteTransactionSchema, WriteDocumentSchema, EditDocumentSchema, type EditDocumentInput } from "../../../packages/protocol/src/tooling.ts";
import { readRegularFile } from "./files.ts";
import { archive, extractDocument } from "./document-extract.ts";
import { authorWorkbook, editWorkbook } from "./workbook-tools.ts";

const marker = "Moguri structured tooling v1";
const encode = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export async function databaseDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for (const suffix of ["", "-wal"]) {
    try {
      const metadata = await lstat(path + suffix);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new MoguriError("sqlite_path", "Database and WAL must be ordinary files, never links.");
      const bytes = await readRegularFile(path + suffix, 16 * 1024 * 1024);
      hash.update(suffix).update(String(bytes.length)).update(":").update(bytes);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      if (!suffix) return "absent";
      hash.update("no-wal");
    }
  }
  return hash.digest("hex");
}
export function sqlScalar(value: unknown): unknown {
  if (typeof value === "bigint") return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return { encoding: "base64", data: Buffer.from(value).toString("base64") };
  return value;
}
const sqlParameters = (values: (string | number | boolean | null)[] = []): SQLInputValue[] => values.map((value) => typeof value === "boolean" ? Number(value) : value);
export function singleStatement(db: DatabaseSync, sql: string): StatementSync {
  const statement = db.prepare(sql);
  const rest = sql.slice(statement.sourceSQL.length).replace(/(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/g, "");
  if (rest) throw new MoguriError("sqlite_statement", "Use one statement per entry. Additional SQL was not silently ignored.");
  statement.setReadBigInts(true);
  return statement;
}
export async function projectSql(kind: "sqlite_query" | "sqlite_transaction", input: unknown, path: string) {
  const args = kind === "sqlite_query" ? parse(SqliteQuerySchema, input) : parse(SqliteTransactionSchema, input);
  const writing = "statements" in args, before = await databaseDigest(path);
  if (!writing && before === "absent") throw new MoguriError("sqlite_missing", "The selected project database does not exist.");
  if (writing && before !== args.expectedDigest) throw new MoguriError("file_conflict", "The database/WAL changed. Query it again before approving a transaction.", 409);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { if ((await lstat(path + suffix)).isSymbolicLink()) throw new MoguriError("sqlite_path", "Database sidecars cannot be symlinks."); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  let created = false;
  if (writing && before === "absent") { const file = await open(path, "wx", 0o600); await file.close(); created = true; }
  const db = new DatabaseSync(path, { readOnly: !writing, allowExtension: false, timeout: 500 });
  let inTransaction = false, internal = true, committed = false;
  try {
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON");
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name);
    if (["events", "retention_metadata", "blob_payloads", "receipts"].every((name) => tables.includes(name))) throw new MoguriError("sqlite_state", "Raw Moguri state is not a project database. Use service-backed todo/memory SQL.");
    db.setAuthorizer((action, first, second) => {
      if ([constants.SQLITE_ATTACH, constants.SQLITE_DETACH, constants.SQLITE_PRAGMA, constants.SQLITE_CREATE_VTABLE, constants.SQLITE_DROP_VTABLE].includes(action) ||
        action === constants.SQLITE_FUNCTION && ["load_extension", "readfile", "writefile"].includes(String(second ?? first).toLowerCase()) ||
        !internal && [constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT].includes(action)) return constants.SQLITE_DENY;
      if (!writing && ![constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE].includes(action)) return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
    if (!writing) {
      internal = false;
      const statement = singleStatement(db, args.sql), rows: Record<string, unknown>[] = [], limit = args.limit ?? 100;
      for (const row of statement.iterate(...sqlParameters(args.parameters))) {
        rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlScalar(value)])));
        if (rows.length > limit) break;
        if (Buffer.byteLength(JSON.stringify(rows)) > 256 * 1024) throw new MoguriError("sqlite_limit", "Selected rows exceed 256 KiB. Select fewer columns or narrower values.");
      }
      return { rows: rows.slice(0, limit), complete: rows.length <= limit, limit, digest: before, integerEncoding: "safe-number-or-decimal-string" };
    }
    db.exec("BEGIN IMMEDIATE"); inTransaction = true;
    if (!created && await databaseDigest(path) !== before) throw new MoguriError("file_conflict", "The database changed before acquiring its transaction. No statements were executed.", 409);
    internal = false;
    const statements = args.statements.map((entry) => {
      const result = singleStatement(db, entry.sql).run(...sqlParameters(entry.parameters));
      return { changes: sqlScalar(result.changes), lastInsertRowid: sqlScalar(result.lastInsertRowid) };
    });
    internal = true; db.exec("COMMIT"); inTransaction = false; committed = true;
    db.close();
    return { statements, committed: true, digest: await databaseDigest(path) };
  } catch (error) {
    if (inTransaction) { internal = true; try { db.exec("ROLLBACK"); inTransaction = false; } catch { throw new MoguriError("tool_partial", "SQL failed and rollback was not acknowledged. Inspect the original database; no retry or success was inferred.", 409); } }
    if (committed || created) throw new MoguriError("tool_partial", `${created ? "The new database file may already exist." : "SQL commit may already have completed."} ${error instanceof Error ? error.message : "Unconfirmed result"} Inspect before retrying.`, 409);
    throw error;
  } finally { try { db.close(); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ERR_INVALID_STATE")) throw error; } }
}

export async function authorDocument(input: unknown): Promise<Buffer> {
  const args = parse(WriteDocumentSchema, input);
  if (args.format === "xlsx") {
    if (!args.sheets?.length || args.paragraphs || args.tables) throw new MoguriError("document_input", "XLSX needs named sheets, not paragraph/table report inputs.");
    return authorWorkbook(args.sheets);
  }
  if (args.sheets || !args.paragraphs?.length && !args.tables?.length) throw new MoguriError("document_input", "Reports need paragraphs/tables, not spreadsheet sheets.");
  if (args.format === "docx") {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell } = await import("docx");
    const paragraphs = (args.paragraphs ?? []).map((item) => new Paragraph({ text: item.text, ...(item.heading ? { style: `Heading${item.heading}` } : {}) }));
    const tables = (args.tables ?? []).map((rows) => new Table({ rows: rows.map((cells) => new TableRow({ children: cells.map((text) => new TableCell({ children: [new Paragraph(text)] })) })) }));
    return Packer.toBuffer(new Document({ creator: "Moguri", description: marker, sections: [{ children: [...paragraphs, ...tables] }] }));
  }
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage(), y = page.getHeight() - 48;
  const lines = [...(args.paragraphs ?? []).map((entry) => ({ text: entry.text, size: entry.heading ? 18 : 11 })),
    ...(args.tables ?? []).flatMap((table) => table.map((row) => ({ text: row.join(" | "), size: 11 })))];
  for (const entry of lines) {
    for (const logical of entry.text.split("\n")) {
      let rest = logical;
      do {
        let end = Math.min(rest.length, 100);
        while (end > 1 && font.widthOfTextAtSize(rest.slice(0, end), entry.size) > page.getWidth() - 96) end--;
        if (y < 48) { if (pdf.getPageCount() >= 200) throw new MoguriError("document_limit", "Generated PDF exceeds 200 pages."); page = pdf.addPage(); y = page.getHeight() - 48; }
        page.drawText(rest.slice(0, end), { x: 48, y, font, size: entry.size });
        y -= entry.size + 5; rest = rest.slice(end);
      } while (rest.length);
    }
  }
  pdf.setCreator("Moguri"); pdf.setSubject(marker);
  return Buffer.from(await pdf.save());
}
export async function editDocument(input: unknown, source: Buffer): Promise<Buffer> {
  const args: EditDocumentInput = parse(EditDocumentSchema, input), format = args.path.split(".").at(-1)?.toLowerCase();
  if (format !== "docx" && format !== "xlsx") throw new MoguriError("document_edit", "Structured edits support DOCX text and generated XLSX cells. Regenerate a PDF using write_document with its exact source digest.");
  await extractDocument(source, format);
  const parts = await archive(source, format);
  if (format === "docx") {
    if (!args.replacements?.length || args.sheets) throw new MoguriError("document_edit", "DOCX edits need explicit unique text replacements.");
    const { unzipSync, zipSync, strToU8 } = await import("fflate"), entries = unzipSync(source);
    let body = parts.get("word/document.xml")!.toString("utf8");
    for (const replacement of args.replacements) {
      const before = encode(replacement.oldText), after = encode(replacement.newText);
      let count = 0;
      const changed = body.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (whole, start: string, text: string, end: string) => {
        let index = text.indexOf(before);
        if (index < 0) return whole;
        while (index >= 0) { count++; index = text.indexOf(before, index + before.length); }
        return start + text.replace(before, after) + end;
      });
      if (count !== 1) throw new MoguriError("document_match", "DOCX oldText must occur exactly once within a single supported body text run. Cross-run/ambiguous edits were not flattened.", 409);
      body = changed;
    }
    entries["word/document.xml"] = strToU8(body);
    return Buffer.from(zipSync(entries));
  }
  return editWorkbook(args, source);
}
