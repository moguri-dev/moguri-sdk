import assert from "node:assert/strict";
import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { DocumentParsers } from "../apps/service/src/documents.ts";
import { generatedDocx, generatedXlsx, generatedPdf, generatedZip, generatedOfficeEntries } from "../tests/fixtures/documents.ts";

const path = resolve(".moguri/document-spike-worker.mjs"), results = [];
await mkdir(resolve(".moguri"), { recursive: true });
await build({ entryPoints: ["apps/service/src/document-worker.ts"], outfile: path, bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" });
const parsers = new DocumentParsers({ workerPath: path });
const measure = async (name, work) => {
  const start = performance.now();
  try { const evidence = await work(); results.push({ name, status: "PASS", elapsedMs: performance.now() - start, ...evidence }); }
  catch (error) { results.push({ name, status: "FAIL", elapsedMs: performance.now() - start, diagnostic: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; }
};
try {
  for (const [format, bytes] of [["pdf", generatedPdf({ imagePage: true })], ["docx", generatedDocx()], ["xlsx", generatedXlsx()]]) {
    await measure(`${format}: local extraction and provenance`, async () => {
      const { document, maxRssKiB } = await parsers.parse(`generated-${format}`, bytes, format);
      assert.ok(document.units.some((unit) => unit.text.includes("GENERATED_DOCUMENT_SECRET")));
      if (format === "pdf") { assert.deepEqual(document.summary.noTextPages, [2]); assert.equal(document.units[0].location.page, 1); }
      if (format === "docx") { assert.equal(document.units[0].location.level, 1); assert.ok(document.units.some((unit) => unit.location.table === 1 && unit.location.column === 2)); }
      if (format === "xlsx") { assert.equal(document.units.find((unit) => unit.location.cell === "C1").formula, "1+2"); assert.equal(document.units.find((unit) => unit.location.cell === "C1").cachedValue, "999"); assert.equal(document.units.find((unit) => unit.location.cell === "D1").cachedValue, null); assert.equal(document.summary.sheets[1].state, "hidden"); }
      return { inputBytes: bytes.length, outputBytes: Buffer.byteLength(JSON.stringify(document)), units: document.units.length, maxRssMiB: maxRssKiB / 1024 };
    });
  }
  await measure("malformed, encrypted, renamed, active-content and expansion rejection", async () => {
    const invalid = [
      ["pdf", Buffer.from("Generated not a PDF")], ["pdf", generatedPdf({ encrypted: true })], ["pdf", generatedPdf({ pages: 201 })],
      ["xlsx", generatedDocx()], ["docx", Buffer.from("d0cf11e0a1b11ae1000000", "hex")],
      ["docx", generatedZip([{ name: "word/document.xml", text: "generated", flags: 1 }])],
      ["docx", generatedZip([{ name: "generated.xml", text: "x", size: 33 * 1024 * 1024 }])],
      ["docx", generatedZip([...generatedOfficeEntries("docx"), { name: "word/vbaProject.bin", text: "Generated inert macro bytes" }])],
      ["docx", generatedZip(generatedOfficeEntries("docx").map((entry) => entry.name === "word/document.xml" ? { ...entry, text: '<!DOCTYPE w [<!ENTITY generated "not expanded">]><w>&generated;</w>' } : entry))],
    ];
    for (const [index, [format, bytes]] of invalid.entries()) await assert.rejects(() => parsers.parse(`generated-invalid-${index}`, bytes, format),
      (error) => typeof error?.code === "string" && error.code.startsWith("document_"));
    return { rejected: invalid.length };
  });
  await measure("concurrency and cancellation", async () => {
    const bytes = generatedDocx(), first = parsers.parse("generated-first", bytes, "docx"), second = parsers.parse("generated-second", bytes, "docx");
    await assert.rejects(() => parsers.parse("generated-third", bytes, "docx"), /already active/i);
    await Promise.all([first, second]);
    const abort = new AbortController(), cancelled = parsers.parse("generated-cancel", bytes, "docx", abort.signal); abort.abort();
    await assert.rejects(() => cancelled, /cancelled/i);
    return { workerLimit: 2, cancelled: true };
  });
  await measure("deadline and memory rejection", async () => {
    const short = new DocumentParsers({ workerPath: path, timeoutMs: 1 }), small = new DocumentParsers({ workerPath: path, rssMiB: 1 });
    try {
      await assert.rejects(() => short.parse("generated-timeout", generatedDocx(), "docx"), /seconds|deadline/i);
      await assert.rejects(() => small.parse("generated-memory", generatedPdf(), "pdf"), /memory/i);
    } finally { await short.close(); await small.close(); }
    return { deadlineMs: 1, observedMemoryMiB: 1 };
  });
} finally { await parsers.close(); await unlink(path); }
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, libraries: { pdfjs: "6.4.299 / Apache-2.0", yauzl: "3.4.0 / MIT", sax: "1.6.1 / BlueOak-1.0.0" }, results }, null, 2));
