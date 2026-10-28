import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, validateTool } from "../apps/service/src/tools.ts";
import { digest } from "../apps/service/src/store.ts";

test("invalid search arguments identify the offending field and limit without echoing private input", () => {
  assert.throws(() => validateTool({ id: "generated-invalid-search", name: "read_file",
    arguments: { path: "generated-private-name.txt", search: "GENERATED_PRIVATE_QUERY", limit: 32768 } }),
  (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error && error.code === "invalid_tool");
    assert.match(error.message, /read_file/); assert.match(error.message, /\/limit/); assert.match(error.message, /16384/);
    assert.equal(error.message.includes("generated-private-name"), false); assert.equal(error.message.includes("GENERATED_PRIVATE_QUERY"), false);
    return true;
  });
  for (const [arguments_, field] of [
    [{ path: "generated-private-name.txt", limit: null }, "/limit"],
    [{ limit: 512 }, "path"],
    [{ path: "generated-private-name.txt", GENERATED_PRIVATE_KEY: "GENERATED_PRIVATE_VALUE" }, "additional"],
    [{ path: "", limit: -1, offset: -1, search: "", mode: "GENERATED_PRIVATE_MODE" }, "additional schema errors omitted"],
  ] as const) {
    assert.throws(() => validateTool({ id: "generated-invalid-field", name: "read_file", arguments: arguments_ }), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error && error.code === "invalid_tool");
      assert.ok(error.message.includes(field));
      assert.ok(error.message.length < 2000);
      assert.equal(error.message.includes("generated-private-name"), false);
      assert.equal(error.message.includes("GENERATED_PRIVATE"), false);
      return true;
    });
  }
  assert.throws(() => validateTool({ id: "generated-unknown", name: "GENERATED_PRIVATE_UNKNOWN", arguments: {} }), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error && error.code === "invalid_tool");
    assert.match(error.message, /Unknown tool/); assert.equal(error.message.includes("GENERATED_PRIVATE"), false);
    return true;
  });
});

test("a bounded README search keeps its selective limit even when full mode is also requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-readme-search-"));
  const source = `${"Generated README source line.\n".repeat(6000)}## Crates\nGenerated selected crate documentation.\n`;
  const run = (args: Record<string, unknown>) => executeTool(root, { id: "generated-readme", name: "read_file", arguments: { path: "README.md", ...args } },
    new AbortController().signal, () => {}, () => {}, undefined, { mode: "read-only", env: "Local", folders: { denied: [], readOnly: [] } });
  try {
    await writeFile(join(root, "README.md"), source);
    const result = await run({ mode: "full", search: "## Crates", limit: 512 });
    const view = JSON.parse(result.text);
    assert.equal(result.isError, false); assert.match(view.text, /selected crate documentation/);
    assert.equal(view.sourceRef.expectedDigest, digest(source));
    assert.equal(result.rawText, source);
    const missing = JSON.parse((await run({ mode: "full", search: "Generated absent section", limit: 512 })).text);
    assert.equal(missing.text, ""); assert.equal(missing.matchOffset, null);
    await assert.rejects(() => run({ mode: "full" }), { code: "file_limit" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

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

test("ordinary reads refresh a stale source reference explicitly while stale edits remain rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-local-source-"));
  const run = (name: string, args: Record<string, unknown>) => executeTool(root, { id: "generated-source", name, arguments: args },
    new AbortController().signal, () => {}, () => {}, undefined, { mode: "agent", env: "Local", folders: { denied: [], readOnly: [] } });
  try {
    await writeFile(join(root, "generated.txt"), "Generated original.");
    const first = JSON.parse((await run("read_file", { path: "generated.txt" })).text);
    assert.equal(first.sourceRef.expectedDigest, digest("Generated original."));
    await writeFile(join(root, "generated.txt"), "Generated external update.");
    const refreshed = JSON.parse((await run("read_file", first.sourceRef)).text);
    assert.equal(refreshed.text, "Generated external update.");
    assert.equal(refreshed.sourceRef.expectedDigest, digest("Generated external update."));
    assert.equal(refreshed.sourceVersion.refreshed, true);
    assert.equal(refreshed.sourceVersion.requestedDigest, first.sourceRef.expectedDigest);
    await assert.rejects(() => run("read_file", { ...first.sourceRef, requireExactVersion: true }), { code: "file_conflict" });
    await assert.rejects(() => run("read_file", { path: "generated.txt", requireExactVersion: true }), { code: "file_version" });
    const restarted = JSON.parse((await run("read_file", { ...first.sourceRef, offset: 8, limit: 9 })).text);
    assert.equal(restarted.text, "Generated");
    assert.equal(restarted.sourceVersion.continuationReset, true);
    assert.equal(restarted.sourceRef.expectedDigest, refreshed.sourceRef.expectedDigest);
    await assert.rejects(() => run("edit_file", { ...first.sourceRef, edits: [{ oldText: "Generated original.", newText: "Must not publish." }] }), { code: "file_conflict" });
    const fresh = JSON.parse((await run("read_file", { path: "generated.txt" })).text);
    assert.equal(fresh.text, "Generated external update.");
    assert.equal((await run("edit_file", { ...fresh.sourceRef, edits: [{ oldText: "external update", newText: "reviewed update" }] })).outcome, "completed");
    assert.equal(await readFile(join(root, "generated.txt"), "utf8"), "Generated reviewed update.");
  } finally { await rm(root, { recursive: true, force: true }); }
});
