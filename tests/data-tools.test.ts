import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../apps/service/src/tools.ts";
import { bytesDigest } from "../apps/service/src/files.ts";
import { extractDocument } from "../apps/service/src/document-extract.ts";

test("structured authors create actual parseable formats and make digest-bound edits", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-authoring-"));
  const run = (name: string, args: Record<string, unknown>) => executeTool(root, { id: "generated-author", name, arguments: args }, new AbortController().signal, () => {}, () => {});
  try {
    for (const format of ["pdf", "docx", "xlsx"] as const) {
      const path = `generated.${format}`;
      const result = await run("write_document", { path, format, expectedDigest: "absent",
        ...(format === "xlsx" ? { sheets: [{ name: "Generated", cells: [{ address: "A1", value: "Generated source" }, { address: "B2", value: 7, formula: "1+2" }] }] } :
          { paragraphs: [{ text: "Generated source", heading: 1 }, { text: "Generated body." }], tables: [[["One", "Two"]]] }) });
      assert.equal(result.outcome, "completed");
      const bytes = await readFile(join(root, path)), parsed = await extractDocument(bytes, format);
      assert.ok(parsed.units.some((unit) => unit.text.includes("Generated")));
      if (format !== "pdf") {
        const edited = await run("edit_document", { path, expectedDigest: bytesDigest(bytes),
          ...(format === "docx" ? { replacements: [{ oldText: "Generated source", newText: "Generated updated" }] } :
            { sheets: [{ name: "Generated", cells: [{ address: "A1", value: "Generated updated" }] }] }) });
        assert.equal(edited.outcome, "completed");
        assert.ok((await extractDocument(await readFile(join(root, path)), format)).units.some((unit) => unit.text.includes("Generated updated")));
        await assert.rejects(() => run("edit_document", { path, expectedDigest: bytesDigest(bytes), replacements: [{ oldText: "Generated", newText: "Stale" }] }), { code: "file_conflict" });
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project SQLite transactions bind the database source, roll back and forbid additional databases", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-sql-tools-"));
  const run = (name: string, args: Record<string, unknown>) => executeTool(root, { id: "generated-sql", name, arguments: args }, new AbortController().signal, () => {}, () => {});
  try {
    const created = await run("sqlite_transaction", { path: "generated.db", expectedDigest: "absent", statements: [
      { sql: "CREATE TABLE generated(id INTEGER PRIMARY KEY, value TEXT NOT NULL)" },
      { sql: "INSERT INTO generated(value) VALUES (?)", parameters: ["Generated value"] },
    ] });
    assert.equal(created.outcome, "completed");
    const queried = JSON.parse((await run("sqlite_query", { path: "generated.db", sql: "SELECT id,value FROM generated" })).text);
    assert.deepEqual(queried.rows, [{ id: 1, value: "Generated value" }]);
    await assert.rejects(() => run("sqlite_query", { path: "generated.db", sql: "ATTACH DATABASE ':memory:' AS hidden" }));
    await assert.rejects(() => run("sqlite_transaction", { path: "generated.db", expectedDigest: "0".repeat(64), statements: [{ sql: "DELETE FROM generated" }] }), { code: "file_conflict" });
    await assert.rejects(() => run("sqlite_transaction", { path: "generated.db", expectedDigest: queried.digest, statements: [
      { sql: "INSERT INTO generated(value) VALUES ('Must roll back')" }, { sql: "INSERT INTO missing VALUES(1)" },
    ] }));
    const after = JSON.parse((await run("sqlite_query", { path: "generated.db", sql: "SELECT count(*) AS count FROM generated" })).text);
    assert.equal(after.rows[0].count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
