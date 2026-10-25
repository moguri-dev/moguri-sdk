import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../apps/service/src/tools.ts";
import { digest } from "../apps/service/src/store.ts";

test("lean edits are exact, atomic, conflict-safe and obey read-only/folder restrictions", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-lean-files-"));
  const run = (name: string, args: Record<string, unknown>, mode: "agent" | "read-only" = "agent") =>
    executeTool(root, { id: "generated", name, arguments: args }, new AbortController().signal, () => {}, () => {}, undefined, { mode, folders: { denied: [], readOnly: [] } });
  try {
    await writeFile(join(root, "sample.ts"), "export const first = 1;\nexport const second = 2;\n");
    const source = await readFile(join(root, "sample.ts"), "utf8");
    const args = { path: "sample.ts", expectedDigest: digest(source), edits: [{ oldText: "first = 1", newText: "first = 3" }] };
    assert.equal((await run("edit_file", args)).outcome, "completed");
    assert.equal(await readFile(join(root, "sample.ts"), "utf8"), source.replace("first = 1", "first = 3"));
    await assert.rejects(() => run("edit_file", args), { code: "file_conflict" });
    await assert.rejects(() => run("edit_file", args, "read-only"), { code: "read_only" });
    const current = await readFile(join(root, "sample.ts"), "utf8");
    await assert.rejects(() => run("edit_file", { ...args, expectedDigest: digest(current), edits: [{ oldText: "missing", newText: "" }] }), { code: "edit_match" });
    assert.equal(await readFile(join(root, "sample.ts"), "utf8"), current);
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "generated.ts"), "export function generated() {}\n");
    await writeFile(join(root, ".gitignore"), "root-ignored.ts\n");
    await writeFile(join(root, ".ignore"), "scratch-ignored.ts\n");
    await writeFile(join(root, "nested", ".gitignore"), "local-ignored.ts\n");
    await writeFile(join(root, "root-ignored.ts"), "Generated ignored source");
    await writeFile(join(root, "scratch-ignored.ts"), "Generated ignored source");
    await writeFile(join(root, "nested", "local-ignored.ts"), "Generated ignored source");
    await writeFile(join(root, "nested", "root-ignored.ts"), "Generated ancestor-ignored source");
    const found = JSON.parse((await run("find_files", { pattern: "**/*.ts" })).text);
    assert.deepEqual(found.files, ["nested/generated.ts", "sample.ts"]);
    assert.equal(found.complete, true);
    assert.deepEqual(JSON.parse((await run("find_files", { pattern: "**/*.ts", path: "nested" })).text).files, ["nested/generated.ts"]);
    const searched = JSON.parse((await run("search_files", { pattern: "function", glob: "*.ts", context: 1 })).text);
    assert.equal(searched.matches[0].path, "nested/generated.ts");
    assert.match(searched.matches[0].text, /generated/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compact search and its original retained source both exclude protected and literal denied paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-search-policy-"));
  try {
    await mkdir(join(root, "private[1]"));
    await writeFile(join(root, "private[1]", "generated.txt"), "GENERATED_SECRET_MATCH");
    await writeFile(join(root, ".git"), "GENERATED_SECRET_MATCH");
    await writeFile(join(root, "generated.txt"), Array.from({ length: 80 }, (_, index) => `GENERATED_VISIBLE_MATCH_${index} ${"a".repeat(900)}\n`).join(""));
    const result = await executeTool(root, { id: "generated-search", name: "search_files", arguments: { pattern: "GENERATED_", context: 0, limit: 100 } }, new AbortController().signal,
      () => {}, () => {}, undefined, { mode: "read-only", folders: { denied: ["private[1]"], readOnly: [] } });
    assert.equal(Buffer.byteLength(result.text) < 14000, true); assert.equal(JSON.parse(result.text).complete, false);
    assert.ok(result.rawText); assert.equal(result.rawText.includes("GENERATED_SECRET"), false);
    assert.equal(result.rawText.includes("GENERATED_VISIBLE_MATCH_79"), true);
    assert.equal(result.rawComplete, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
