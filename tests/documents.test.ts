import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DOCUMENT_LIMITS as L, type DocumentFormat } from "../packages/protocol/src/documents.ts";
import { DocumentParsers } from "../apps/service/src/documents.ts";
import { documentPage, documentSearch } from "../apps/service/src/document-reads.ts";
import { generatedDocx, generatedXlsx, generatedPdf, generatedZip, generatedOfficeEntries, wordNamespace, sheetNamespace } from "./fixtures/documents.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("concurrency is reserved before source bytes are loaded, across parser/profile instances", async () => {
  const first = new DocumentParsers(), second = new DocumentParsers();
  let release!: () => void, reads = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = async () => { reads++; await gate; return generatedDocx(); };
  try {
    const a = first.capture("generated-first-source", read, "docx"), b = second.capture("generated-second-source", read, "docx");
    await assert.rejects(() => second.capture("generated-excess-source", async () => { assert.fail("Excess captures must not load originals."); }, "docx"), /already active/i);
    assert.equal(reads, 2); release();
    await Promise.all([a, b]);
  } finally { release(); await first.close(); await second.close(); }
});

test("PDF extraction retains exact pages and identifies image-only pages without pretending OCR", async () => {
  const parsers = new DocumentParsers();
  try {
    const { document } = await parsers.parse("generated-pdf", generatedPdf({ imagePage: true }), "pdf");
    assert.equal(document.summary.pages, 2); assert.deepEqual(document.summary.noTextPages, [2]); assert.equal(document.summary.status, "limited");
    assert.match(document.summary.limitations.join(" "), /OCR.*unavailable|unavailable.*OCR/);
    const page = documentPage(document, { page: 1, limit: 200 });
    assert.equal(page.firstLocation?.page, 1); assert.ok(Buffer.byteLength(page.text) <= 200);
    assert.match(page.text, /Generated PDF page 1/); assert.equal(page.untrusted, true);
    assert.match(documentPage(document, { page: 2 }).text, /"text":""/);
    assert.throws(() => documentPage(document, { page: 3 }), /does not exist/);
  } finally { await parsers.close(); }
});

test("DOCX headings, body paragraphs, tables and UTF-8 pagination retain provenance", async () => {
  const parsers = new DocumentParsers();
  try {
    const { document } = await parsers.parse("generated-docx", generatedDocx(), "docx");
    assert.equal(document.units[0]?.location.level, 1);
    assert.equal(document.summary.tables, 1);
    assert.equal(document.units[3]?.location.column, 2);
    const parts: string[] = []; let offset: number | null = 0;
    do {
      const page = documentPage(document, { section: 2, offset, limit: 7 });
      assert.ok(Buffer.byteLength(page.text) <= 7); parts.push(page.text); offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(parts.join(""), JSON.stringify(document.units[1]) + "\n");
    assert.match(parts.join(""), /\u{1f34a}/u);
    assert.throws(() => documentPage(document, { sheet: "Generated sheet" }), /selectors|XLSX/);
    assert.throws(() => documentPage(document, { limit: 16385 }), /16,384/);
    const found = documentSearch(document, { query: "table cell B" });
    assert.equal(found.matches[0]?.location.table, 1); assert.equal(found.matches[0]?.location.column, 2);
    assert.deepEqual(documentSearch(document, { query: ".*" }).matches, []);
  } finally { await parsers.close(); }
});

test("XLSX keeps sparse coordinates, hidden sheets, cached values and shared/external formulas strictly inert", async () => {
  const parsers = new DocumentParsers();
  try {
    const { document } = await parsers.parse("generated-xlsx", generatedXlsx(), "xlsx");
    assert.equal(document.summary.cells, 7); assert.equal(document.summary.sheets[1]?.state, "hidden");
    assert.equal(document.units[0]?.cachedValue, "GENERATED_DOCUMENT_SECRET shared value");
    const formula = document.units.find((unit) => unit.location.cell === "C1")!;
    assert.equal(formula.formula, "1+2"); assert.equal(formula.cachedValue, "999");
    const external = document.units.find((unit) => unit.location.cell === "D1")!;
    assert.match(external.formula!, /WEBSERVICE/); assert.equal(external.cachedValue, null);
    const shared = document.units.find((unit) => unit.location.sheet === "Generated hidden" && unit.location.cell === "A2")!;
    assert.equal(shared.formula, ""); assert.equal(shared.formulaAttributes?.si, "7");
    const page = documentPage(document, { sheet: "Generated sheet", range: "B1:C1" });
    assert.match(page.text, /"cell":"B1"/); assert.match(page.text, /"cell":"C1"/);
    assert.doesNotMatch(page.text, /WEBSERVICE|GENERATED_DOCUMENT_SECRET/);
    assert.throws(() => documentPage(document, { range: "A1:B2" }), /exact XLSX sheet/);
    assert.throws(() => documentPage(document, { sheet: "Generated sheet", range: "XFE1:XFE2" }), /coordinate bounds/);
    assert.equal(documentSearch(document, { query: "WEBSERVICE", sheet: "Generated sheet" }).matches[0]?.location.cell, "D1");
  } finally { await parsers.close(); }
});

test("search continuation is bounded and never loses or repeats a literal match", async () => {
  const parsers = new DocumentParsers();
  const entries = generatedOfficeEntries("docx");
  entries.find((entry) => entry.name === "word/document.xml")!.text = `<w:document xmlns:w="${wordNamespace}"><w:body>${Array.from({ length: 47 }, (_, index) => `<w:p><w:r><w:t>Generated needle ${index}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  try {
    const { document } = await parsers.parse("generated-search", generatedZip(entries), "docx");
    const sections: number[] = []; let cursor: number | null = 0;
    do {
      const page = documentSearch(document, { query: "needle", cursor, limit: 7 });
      assert.ok(page.matches.length <= 7); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= L.readBytes);
      sections.push(...page.matches.map((match) => match.location.section)); cursor = page.nextCursor;
    } while (cursor !== null);
    assert.deepEqual(sections, Array.from({ length: 47 }, (_, index) => index + 1));
  } finally { await parsers.close(); }
});

test("signatures, encrypted formats, malformed XML/ZIP, CRC, active content and namespace mismatches fail explicitly", async () => {
  const parsers = new DocumentParsers();
  const malformed = generatedOfficeEntries("docx").map((entry) => entry.name === "word/document.xml" ? { ...entry, text: "<w:document>" } : entry);
  const cases: [DocumentFormat, Buffer][] = [
    ["pdf", Buffer.from("Generated wrong signature")], ["pdf", Buffer.from("%PDF-1.7\nGenerated malformed body\n%%EOF\n")],
    ["pdf", generatedPdf({ encrypted: true })], ["docx", Buffer.from("d0cf11e0a1b11ae100", "hex")],
    ["docx", generatedZip([{ name: "word/document.xml", flags: 1, text: "Generated encrypted header" }])],
    ["docx", generatedZip(malformed)], ["xlsx", generatedDocx()],
    ["docx", generatedZip(generatedOfficeEntries("docx").map((entry) => entry.name === "word/document.xml" ? { ...entry, text: `<w:document xmlns:w="${wordNamespace}"><w:body><w:p><w:r><w:t>&nbsp;</w:t></w:r></w:p></w:body></w:document>` } : entry))],
    ["docx", generatedZip(generatedOfficeEntries("docx").map((entry) => entry.name === "word/document.xml" ? { ...entry, crc: 0 } : entry))],
    ["xlsx", generatedZip([...generatedOfficeEntries("xlsx"), { name: "xl/vbaProject.bin", text: "Generated inert macro" }])],
    ["docx", generatedZip([...generatedOfficeEntries("docx"), { name: "../generated.xml", text: "Generated traversal" }])],
    ["docx", generatedZip(generatedOfficeEntries("docx").map((entry) => entry.name === "word/document.xml" ? { ...entry, text: '<!DOCTYPE doc [<!ENTITY x SYSTEM "https://generated.invalid/never">]><doc>&x;</doc>' } : entry))],
    ["xlsx", generatedZip(generatedOfficeEntries("xlsx").map((entry) => entry.name === "xl/workbook.xml" ? { ...entry, text: entry.text!.replaceAll("spreadsheetml/2006/main", "generated/invalid") } : entry))],
  ];
  try {
    for (const [index, [format, data]] of cases.entries()) await assert.rejects(() => parsers.parse(`generated-invalid-${index}`, data, format),
      (error: unknown) => error instanceof Error && "code" in error && String(error.code).startsWith("document_"));
  } finally { await parsers.close(); }
});

test("original, page, archive entry/count/expansion, XML depth and complete-output bounds reject instead of truncating", { timeout: ciTime(30_000) }, async () => {
  const parsers = new DocumentParsers();
  const deep = generatedOfficeEntries("docx");
  deep.find((entry) => entry.name === "word/document.xml")!.text = `<w:document xmlns:w="${wordNamespace}"><w:body>${"<w:sdt>".repeat(65)}<w:p/>${"</w:sdt>".repeat(65)}</w:body></w:document>`;
  const largeText = generatedOfficeEntries("docx"), paragraphs = Array.from({ length: 600 }, () => `<w:p><w:r><w:t>${randomBytes(2000).toString("hex")}</w:t></w:r></w:p>`).join("");
  largeText.find((entry) => entry.name === "word/document.xml")!.text = `<w:document xmlns:w="${wordNamespace}"><w:body>${paragraphs}</w:body></w:document>`;
  const expansion = Buffer.from(randomBytes(6400).toString("hex"));
  const cases: [DocumentFormat, Buffer][] = [
    ["pdf", Buffer.alloc(L.originalBytes + 1)], ["pdf", generatedPdf({ pages: L.pages + 1 })],
    ["docx", generatedZip(Array.from({ length: L.entries + 1 }, (_, index) => ({ name: `generated-${index}.xml`, text: "<x/>" })))],
    ["docx", generatedZip([{ name: "generated.xml", text: "generated", size: L.entryBytes + 1 }])],
    ["docx", generatedZip([{ name: "generated.xml", bytes: Buffer.alloc(1024 * 1024) }])],
    ["docx", generatedZip(deep)], ["docx", generatedZip(largeText)],
    ["docx", generatedZip(Array.from({ length: 5 }, (_, index) => ({ name: `generated-${index}.xml`, bytes: Buffer.concat([Buffer.from("<generated>"), ...Array.from({ length: 560 }, () => expansion), Buffer.from("</generated>")]) })))],
  ];
  try {
    for (const [index, [format, data]] of cases.entries()) await assert.rejects(() => parsers.parse(`generated-limit-${index}`, data, format),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "document_limit");
  } finally { await parsers.close(); }
});

test("the independent in-process watchdog stops a CPU-blocked parser without relying on a parent timeout or responsive parser event loop", { timeout: ciTime(8000) }, async () => {
  const worker = resolve("dist/document-worker.mjs");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import {Worker} from "node:worker_threads";
    const watchdog=new Worker(${JSON.stringify(worker)},{execArgv:[],workerData:{deadline:Date.now()+${ciTime(500)},rssBytes:384*1024*1024}});
    watchdog.once("message",()=>{process.stdout.write("GENERATED_WATCHDOG_READY\\n");while(true){}});
  `], { stdio: ["ignore", "pipe", "pipe"], env: {} });
  let output = "", stderr = "", emergencyUsed = false;
  child.stdout.on("data", (data: Buffer) => { output += data.toString("utf8"); });
  child.stderr.on("data", (data: Buffer) => { stderr += data.toString("utf8"); });
  // The deadline starts before the worker boots, so slower runners need the scaled window to report ready first.
  const emergency = setTimeout(() => { emergencyUsed = true; child.kill("SIGKILL"); }, ciTime(4000));
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });

    assert.match(output, /GENERATED_WATCHDOG_READY/, stderr); assert.equal(result.signal, "SIGKILL"); assert.equal(emergencyUsed, false);
  } finally { clearTimeout(emergency); if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL"); }
});

test("sheet and actual-cell bounds are checked before rendering output or trusting giant declared dimensions", async () => {
  const parsers = new DocumentParsers(), sheets = generatedOfficeEntries("xlsx"), cells = generatedOfficeEntries("xlsx");
  sheets.find((entry) => entry.name === "xl/workbook.xml")!.text = `<workbook xmlns="${sheetNamespace}"><sheets>${Array.from({ length: L.sheets + 1 }, (_, index) => `<sheet name="Generated ${index}" sheetId="${index + 1}"/>`).join("")}</sheets></workbook>`;
  cells.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!.text = `<worksheet xmlns="${sheetNamespace}"><sheetData>${Array.from({ length: L.cells + 1 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"/></row>`).join("")}</sheetData></worksheet>`;
  try {
    await assert.rejects(() => parsers.parse("generated-sheets", generatedZip(sheets), "xlsx"), /1\.\.32 sheets/);
    await assert.rejects(() => parsers.parse("generated-cells", generatedZip(cells), "xlsx"), /50,000 actual cells/);
  } finally { await parsers.close(); }
});
